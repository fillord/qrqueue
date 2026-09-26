import { useCallback, useEffect, useRef, useState } from 'react'

import type { TvState } from '../api/types'

export interface TvSpotlightCall {
  ticket_id: string
  display_number: string
  cabinet_label: string | null
  queue_name: string
  call_count: number
}

const SPOTLIGHT_DURATION_MS = 4000

export function useTvSpotlight(state: TvState | null): TvSpotlightCall | null {
  const [active, setActive] = useState<TvSpotlightCall | null>(null)
  const previousRef = useRef<Map<string, number> | null>(null)
  const pendingRef = useRef<TvSpotlightCall[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNext = useCallback(function advance() {
    const next = pendingRef.current.shift() ?? null
    setActive(next)
    timerRef.current = next ? setTimeout(advance, SPOTLIGHT_DURATION_MS) : null
  }, [])

  useEffect(() => {
    if (!state) {
      previousRef.current = null
      pendingRef.current = []
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      setActive(null)
      return
    }

    const calls = state.queues.flatMap((queue) => queue.active_calls.map((call) => ({
      ...call,
      queue_name: queue.queue_name,
    })))
    const previous = previousRef.current
    previousRef.current = new Map(calls.map((call) => [call.ticket_id, call.call_count]))

    // The first snapshot may contain calls already on screen; only highlight later events.
    if (!previous) return
    const newCalls = calls.filter((call) => call.call_count !== previous.get(call.ticket_id))
    if (!newCalls.length) return
    pendingRef.current.push(...newCalls)
    if (!timerRef.current) showNext()
  }, [state, showNext])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return active
}
