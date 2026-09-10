import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import { getTicket } from '../api/public'
import type { TicketDetail } from '../api/types'

const POLL_INTERVAL_MS = 5000
const TERMINAL_STATUSES: TicketDetail['status'][] = ['served', 'no_show', 'left', 'transferred']

export interface UseTicketResult {
  ticket: TicketDetail | null
  loading: boolean
  notFound: boolean
  error: string | null
}

/**
 * Polls GET /api/public/tickets/:id every 5s. This is a stand-in for
 * real-time updates until the WebSocket lands in step 5 — callers only see
 * { ticket, loading, notFound, error }, so swapping the transport later
 * won't touch any consumer of this hook.
 */
export function useTicket(ticketId: string | undefined): UseTicketResult {
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticketId) return undefined

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      try {
        const data = await getTicket(ticketId as string)
        if (cancelled) return
        setTicket(data)
        setNotFound(false)
        setError(null)
        if (!TERMINAL_STATUSES.includes(data.status)) {
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else {
          setError(err instanceof Error ? err.message : 'unknown_error')
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [ticketId])

  return { ticket, loading, notFound, error }
}
