import { useCallback, useEffect, useRef, useState } from 'react'

import type { QrBatch } from '../api/types'

const REFRESH_BEFORE_END_MS = 3 * 60 * 1000
const RETRY_AFTER_FAILURE_MS = 5000

/**
 * Cycles through a batch of overlapping QR tokens (ARCHITECTURE.md section
 * 4) on a schedule driven by the batch's own `server_time`, not the
 * device's local clock — so a screen with a wrong/drifting clock still
 * switches codes at the right moment relative to the server. Fetches a new
 * batch proactively once under 3 minutes of the current one remains, and if
 * the network is down, keeps cycling whatever tokens are already known
 * rather than going blank.
 */
export function useLiveQr(fetchBatch: () => Promise<QrBatch>): { token: string | null } {
  const [activeToken, setActiveToken] = useState<string | null>(null)
  const offsetMsRef = useRef(0) // server time minus Date.now(), captured at the last successful fetch
  const tokensRef = useRef<QrBatch['tokens']>([])
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const cancelledRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const batch = await fetchBatch()
      if (cancelledRef.current) return
      offsetMsRef.current = new Date(batch.server_time).getTime() - Date.now()
      tokensRef.current = batch.tokens
      scheduleNext()
    } catch {
      if (cancelledRef.current) return
      if (tokensRef.current.length > 0) {
        scheduleNext()
      } else {
        refreshTimerRef.current = setTimeout(() => void refresh(), RETRY_AFTER_FAILURE_MS)
      }
    }
  }, [fetchBatch])

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)

    const nowServer = Date.now() + offsetMsRef.current
    const tokens = tokensRef.current
    const current = tokens.find(
      (t) => new Date(t.nbf).getTime() <= nowServer && nowServer < new Date(t.exp).getTime(),
    )
    const upcoming = tokens
      .filter((t) => new Date(t.nbf).getTime() > nowServer)
      .sort((a, b) => new Date(a.nbf).getTime() - new Date(b.nbf).getTime())

    if (current) {
      setActiveToken(current.token)

      if (upcoming.length > 0) {
        const msUntilNext = new Date(upcoming[0].nbf).getTime() - nowServer
        timerRef.current = setTimeout(scheduleNext, Math.max(0, msUntilNext))
      } else {
        const msUntilExpire = new Date(current.exp).getTime() - nowServer
        timerRef.current = setTimeout(() => void refresh(), Math.max(0, msUntilExpire))
      }

      const batchEnd = Math.max(...tokens.map((t) => new Date(t.exp).getTime()))
      const msUntilRefresh = batchEnd - nowServer - REFRESH_BEFORE_END_MS
      refreshTimerRef.current = setTimeout(() => void refresh(), Math.max(0, msUntilRefresh))
    } else if (upcoming.length > 0) {
      timerRef.current = setTimeout(
        scheduleNext,
        Math.max(0, new Date(upcoming[0].nbf).getTime() - nowServer),
      )
    } else {
      void refresh()
    }
  }, [refresh])

  useEffect(() => {
    cancelledRef.current = false
    void refresh()
    return () => {
      cancelledRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [refresh])

  return { token: activeToken }
}
