import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '../api/client'
import { getOperatorQueue } from '../api/operator'
import type { OperatorQueue } from '../api/types'

const POLL_INTERVAL_MS = 3000

export interface UseOperatorQueueResult {
  queue: OperatorQueue | null
  loading: boolean
  cabinetNotSelected: boolean
  refresh: () => void
}

/**
 * Polls GET /api/operator/queue every 3s. Callers only see
 * { queue, loading, cabinetNotSelected, refresh } — swapping this for a
 * WebSocket push in step 5 won't touch any consumer of this hook.
 */
export function useOperatorQueue(): UseOperatorQueueResult {
  const [queue, setQueue] = useState<OperatorQueue | null>(null)
  const [loading, setLoading] = useState(true)
  const [cabinetNotSelected, setCabinetNotSelected] = useState(false)
  const cancelledRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const pollOnce = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
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
      // any other error is transient — keep the last known state, next tick retries
    } finally {
      if (!cancelledRef.current) {
        setLoading(false)
        timerRef.current = setTimeout(() => void pollOnce(), POLL_INTERVAL_MS)
      }
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    void pollOnce()
    return () => {
      cancelledRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [pollOnce])

  return { queue, loading, cabinetNotSelected, refresh: () => void pollOnce() }
}
