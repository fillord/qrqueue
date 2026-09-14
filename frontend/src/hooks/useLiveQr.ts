import { useEffect, useState } from 'react'

import type { QrBatch } from '../api/types'

const REFRESH_BEFORE_END_MS = 3 * 60 * 1000
const RETRY_AFTER_FAILURE_MS = 5000

/** Keep token rotation independent of network retries so an expired batch
 * is cleared even while its replacement request is still in flight. */
export function useLiveQr(
  fetchBatch: () => Promise<QrBatch>,
  enabled = true,
): { token: string | null; offline: boolean } {
  const [token, setToken] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    let offsetMs = 0
    let tokens: { token: string; start: number; end: number }[] = []
    let rotationTimer: ReturnType<typeof setTimeout> | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    setToken(null)
    setOffline(false)
    if (!enabled) return

    function rotate() {
      if (cancelled) return
      clearTimeout(rotationTimer)
      const now = Date.now() + offsetMs
      // Latest started window wins during the 15-second overlap.
      const current = tokens.find((item) => item.start <= now && now < item.end)
      setToken(current?.token ?? null)
      const boundaries = tokens.flatMap((item) => [item.start, item.end]).filter((time) => time > now)
      if (boundaries.length) {
        rotationTimer = setTimeout(rotate, Math.min(...boundaries) - now)
      }
    }

    async function refresh() {
      if (cancelled || inFlight) return
      clearTimeout(refreshTimer)
      inFlight = true
      let delay = RETRY_AFTER_FAILURE_MS
      try {
        const batch = await fetchBatch()
        if (cancelled) return
        const serverTime = Date.parse(batch.server_time)
        const nextTokens = batch.tokens.map((item) => ({
          token: item.token, start: Date.parse(item.nbf), end: Date.parse(item.exp),
        })).filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > serverTime)
        if (!Number.isFinite(serverTime) || !nextTokens.length) throw new Error('Empty or expired QR batch')
        offsetMs = serverTime - Date.now()
        tokens = nextTokens.sort((a, b) => b.start - a.start)
        setOffline(false)
        rotate()
        delay = Math.max(RETRY_AFTER_FAILURE_MS, Math.max(...tokens.map((item) => item.end)) - serverTime - REFRESH_BEFORE_END_MS)
      } catch {
        if (!cancelled) setOffline(true)
      } finally {
        inFlight = false
        if (!cancelled) refreshTimer = setTimeout(() => void refresh(), delay)
      }
    }

    function resume() {
      rotate()
      void refresh()
    }
    function handleVisibility() {
      if (document.visibilityState === 'visible') resume()
    }
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', handleVisibility)
    void refresh()
    return () => {
      cancelled = true
      clearTimeout(rotationTimer)
      clearTimeout(refreshTimer)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchBatch, enabled])

  return { token, offline }
}
