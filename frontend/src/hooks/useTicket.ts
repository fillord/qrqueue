import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import { getTicket } from '../api/public'
import type { TicketDetail } from '../api/types'
import { openReconnectingSocket, wsBaseUrl } from '../lib/reconnectingWebSocket'

export interface UseTicketResult {
  ticket: TicketDetail | null
  loading: boolean
  notFound: boolean
  error: string | null
}

/**
 * WS /ws/ticket/:id for live updates (reconnects with exponential backoff —
 * see lib/reconnectingWebSocket), with a REST GET fired on mount and on
 * every (re)connect as a belt-and-suspenders safety net against a missed
 * push. External shape is unchanged from the step-3/4b polling version, so
 * TicketPage didn't need to change at all for this swap.
 */
export function useTicket(ticketId: string | undefined): UseTicketResult {
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticketId) return undefined

    let cancelled = false

    async function fetchOnce() {
      try {
        const data = await getTicket(ticketId as string)
        if (cancelled) return
        setTicket(data)
        setNotFound(false)
        setError(null)
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else {
          setError(err instanceof Error ? err.message : 'unknown_error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchOnce()

    const handle = openReconnectingSocket({
      url: `${wsBaseUrl()}/ws/ticket/${ticketId}`,
      onOpen: () => void fetchOnce(),
      onMessage: (data) => {
        if (cancelled) return
        setTicket(data as TicketDetail)
        setNotFound(false)
        setError(null)
        setLoading(false)
      },
    })

    return () => {
      cancelled = true
      handle.close()
    }
  }, [ticketId])

  return { ticket, loading, notFound, error }
}
