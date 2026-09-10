import { useCallback, useEffect, useRef, useState } from 'react'

import { getTvState } from '../api/tv'
import type { TvState } from '../api/types'
import { openReconnectingSocket, wsBaseUrl } from '../lib/reconnectingWebSocket'

export interface UseTvStateResult {
  state: TvState | null
  loading: boolean
  rejected: boolean
}

/**
 * WS /ws/tv?device_token=... for live updates, with a REST GET fired on
 * mount and on every (re)connect as a safety net. `rejected` is set if the
 * device_token turns out to be invalid (the initial REST call 401s) — the
 * page then forgets it and sends the operator back to /tv/pair.
 */
export function useTvState(deviceToken: string): UseTvStateResult {
  const [state, setState] = useState<TvState | null>(null)
  const [loading, setLoading] = useState(true)
  const [rejected, setRejected] = useState(false)
  const cancelledRef = useRef(false)

  const fetchOnce = useCallback(async () => {
    try {
      const data = await getTvState(deviceToken)
      if (cancelledRef.current) return
      setState(data)
      setRejected(false)
    } catch {
      if (cancelledRef.current) return
      setRejected(true)
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [deviceToken])

  useEffect(() => {
    cancelledRef.current = false
    void fetchOnce()

    const handle = openReconnectingSocket({
      url: `${wsBaseUrl()}/ws/tv?device_token=${encodeURIComponent(deviceToken)}`,
      onOpen: () => void fetchOnce(),
      onMessage: (data) => {
        if (cancelledRef.current) return
        setState(data as TvState)
        setRejected(false)
        setLoading(false)
      },
    })

    return () => {
      cancelledRef.current = true
      handle.close()
    }
  }, [deviceToken, fetchOnce])

  return { state, loading, rejected }
}
