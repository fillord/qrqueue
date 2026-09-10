import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'
import { getOperatorQueue } from '../api/operator'
import type { OperatorQueue } from '../api/types'
import { openReconnectingSocket, wsBaseUrl } from '../lib/reconnectingWebSocket'

export interface UseOperatorQueueResult {
  queue: OperatorQueue | null
  loading: boolean
  cabinetNotSelected: boolean
  refresh: () => void
}

/**
 * WS /ws/operator for live updates (reconnects with exponential backoff),
 * with a REST GET fired on mount and on every (re)connect as a safety net.
 * `cabinet_not_selected` is only ever detected via that REST call — the
 * server rejects the WS handshake outright in that case (browsers surface
 * that as a generic failed connection, no usable close code), and `refresh`
 * stays a REST call too, for the immediate self-feedback OperatorQueuePage
 * wants right after firing an action, without waiting on a round trip
 * through Redis pub/sub. External shape is unchanged from the step-4b
 * polling version, so OperatorQueuePage didn't need to change for this swap.
 */
export function useOperatorQueue(): UseOperatorQueueResult {
  const [queue, setQueue] = useState<OperatorQueue | null>(null)
  const [loading, setLoading] = useState(true)
  const [cabinetNotSelected, setCabinetNotSelected] = useState(false)
  const cancelledRef = useRef(false)

  const fetchOnce = useCallback(async () => {
    try {
      const data = await getOperatorQueue()
      if (cancelledRef.current) return
      setQueue(data)
      setCabinetNotSelected(false)
    } catch (err) {
      if (cancelledRef.current) return
      if (err instanceof ApiError && err.status === 409 && err.code === 'cabinet_not_selected') {
        setCabinetNotSelected(true)
      }
      // any other error is transient — keep the last known state
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    void fetchOnce()

    const handle = openReconnectingSocket({
      url: `${wsBaseUrl()}/ws/operator`,
      onOpen: () => void fetchOnce(),
      onMessage: (data) => {
        if (cancelledRef.current) return
        setQueue(data as OperatorQueue)
        setCabinetNotSelected(false)
        setLoading(false)
      },
    })

    return () => {
      cancelledRef.current = true
      handle.close()
    }
  }, [fetchOnce])

  return { queue, loading, cabinetNotSelected, refresh: () => void fetchOnce() }
}
