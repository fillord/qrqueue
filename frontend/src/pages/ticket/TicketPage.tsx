import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { confirmTicket, getMyTickets, leaveTicket } from '../../api/public'
import type { TicketDetail } from '../../api/types'
import { useTicket } from '../../hooks/useTicket'
import { forgetTicketId, rememberTicketId } from '../../lib/ticketStorage'

/**
 * /t/:id — ticket page. Live updates via useTicket (WebSocket, see that
 * hook's docstring). `ticket` here is a local shadow of the hook's value —
 * synced from it on every change, but also settable directly from the
 * confirm/leave response for instant feedback instead of waiting on the
 * round trip back through the socket.
 */
export default function TicketPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { ticket: liveTicket, loading, notFound } = useTicket(id)
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (liveTicket) setTicket(liveTicket)
  }, [liveTicket])

  useEffect(() => {
    if (id) rememberTicketId(id)
  }, [id])

  async function handleCheckMyTickets() {
    try {
      const tickets = await getMyTickets()
      if (tickets.length > 0) {
        navigate(`/t/${tickets[0].id}`, { replace: true })
        return
      }
    } catch {
      // ignore — fall through to landing
    }
    forgetTicketId()
    navigate('/', { replace: true })
  }

  async function handleConfirm() {
    if (!id) return
    setSubmitting(true)
    setActionError(null)
    try {
      setTicket(await confirmTicket(id))
    } catch {
      setActionError(t('ticket.actions.error'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLeave() {
    if (!id) return
    setSubmitting(true)
    setActionError(null)
    try {
      setTicket(await leaveTicket(id))
    } catch {
      setActionError(t('ticket.actions.error'))
    } finally {
      setSubmitting(false)
    }
  }

  if (notFound) {
    return (
      <div className="ticket-page ticket-page--not-found">
        <p className="ticket-page__message">{t('ticket.notFound.message')}</p>
        <button type="button" onClick={() => void handleCheckMyTickets()}>
          {t('ticket.notFound.checkButton')}
        </button>
      </div>
    )
  }

  if (loading || !ticket) {
    return (
      <div className="ticket-page">
        <div className="spinner" aria-hidden="true" />
      </div>
    )
  }

  const canLeave = ticket.status === 'waiting' || ticket.status === 'called' || ticket.status === 'confirmed'

  return (
    <div className="ticket-page">
      {ticket.queue_status !== 'open' && (
        <div className={`ticket-page__banner ticket-page__banner--${ticket.queue_status}`}>
          {t(`ticket.queueStatus.${ticket.queue_status}`)}
        </div>
      )}

      <div className="ticket-page__number">{ticket.display_number}</div>

      <StatusBlock ticket={ticket} />

      {canLeave && (
        <div className="ticket-page__actions">
          {ticket.status === 'called' && (
            <button type="button" disabled={submitting} onClick={() => void handleConfirm()}>
              {t('ticket.actions.imHere')}
            </button>
          )}
          <button
            type="button"
            className="ticket-page__leave-btn"
            disabled={submitting}
            onClick={() => void handleLeave()}
          >
            {t('ticket.actions.leave')}
          </button>
          {actionError && <p className="ticket-page__action-error">{actionError}</p>}
        </div>
      )}
    </div>
  )
}

function StatusBlock({ ticket }: { ticket: TicketDetail }) {
  const { t } = useTranslation()

  if (ticket.status === 'waiting') {
    return (
      <div className="ticket-page__info">
        {ticket.position != null && (
          <p className="ticket-page__position">
            {t('ticket.position', { position: ticket.position })}
          </p>
        )}
        {ticket.now_serving && (
          <p className="ticket-page__now-serving">
            {t('ticket.nowServing', { number: ticket.now_serving })}
          </p>
        )}
        <p className="ticket-page__status">{t('ticket.status.waiting')}</p>
      </div>
    )
  }

  if (ticket.status === 'called' || ticket.status === 'serving') {
    const label = ticket.cabinet?.label
    const key = ticket.status === 'called'
      ? (label ? 'ticket.calledAt' : 'ticket.status.called')
      : (label ? 'ticket.servingAt' : 'ticket.status.serving')

    return (
      <div className={`ticket-page__info ticket-page__info--${ticket.status}`}>
        <p className="ticket-page__called-message">{t(key, { label })}</p>
      </div>
    )
  }

  return <p className="ticket-page__status">{t(`ticket.status.${ticket.status}`)}</p>
}
