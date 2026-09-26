import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import { getTvState, sendTvHeartbeat } from '../api/tv'
import type { TvState } from '../api/types'
import { openReconnectingSocket, wsBaseUrl } from '../lib/reconnectingWebSocket'

export interface UseTvStateResult {
  state: TvState | null
  loading: boolean
  rejected: boolean
  offline: boolean
}

export function useTvState(deviceToken: string): UseTvStateResult {
  const [state, setState] = useState<TvState | null>(null)
  const [loading, setLoading] = useState(true)
  const [rejected, setRejected] = useState(false)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let cancelled = false
    let revision = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setState(null)
    setLoading(true)
    setRejected(false)
    setOffline(false)
    if (!deviceToken) { setLoading(false); return }

    async function fetchOnce() {
      clearTimeout(retryTimer)
      const requestRevision = ++revision
      try {
        const data = await getTvState(deviceToken)
        if (cancelled || requestRevision !== revision) return
        setState(data)
        setRejected(false)
        setOffline(false)
      } catch (error) {
        if (cancelled || requestRevision !== revision) return
        if (error instanceof ApiError && error.status === 401) {
          setRejected(true)
        } else {
          setOffline(true)
          retryTimer = setTimeout(() => void fetchOnce(), 5000)
        }
      } finally {
        if (!cancelled && requestRevision === revision) setLoading(false)
      }
    }

    void fetchOnce()
    const heartbeat = window.setInterval(() => {
      void sendTvHeartbeat(deviceToken).catch((error) => {
        if (!cancelled && error instanceof ApiError && error.status === 401) setRejected(true)
      })
    }, 30_000)
    const handle = openReconnectingSocket({
      url: `${wsBaseUrl()}/ws/tv?device_token=${encodeURIComponent(deviceToken)}`,
      onOpen: () => void fetchOnce(),
      onClose: () => {
        if (!cancelled) {
          setOffline(true)
          void fetchOnce() // A revoked device token is rejected immediately, without waiting for the next heartbeat.
        }
      },
      onMessage: (data) => {
        if (cancelled) return
        revision += 1 // An older REST response must not overwrite a live snapshot.
        clearTimeout(retryTimer)
        setState(data as TvState)
        setRejected(false)
        setOffline(false)
        setLoading(false)
      },
    })
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      window.clearInterval(heartbeat)
      handle.close()
    }
  }, [deviceToken])

  return { state, loading, rejected, offline }
}
