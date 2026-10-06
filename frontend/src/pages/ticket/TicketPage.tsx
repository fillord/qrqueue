import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { confirmTicket, getMyTickets, leaveTicket } from '../../api/public'
import type { TicketDetail } from '../../api/types'
import PushOptInBanner from '../../components/PushOptInBanner'
import TelegramTicketBanner from '../../components/TelegramTicketBanner'
import RatingForm from '../../components/RatingForm'
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
  const { ticket: liveTicket, loading, notFound, error: loadError } = useTicket(id)
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (liveTicket?.status === 'transferred' && liveTicket.next_ticket_id) {
      navigate(`/t/${liveTicket.next_ticket_id}`, { replace: true })
      return
    }
    if (liveTicket) setTicket(liveTicket)
  }, [liveTicket, navigate])

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
        {loadError && !loading ? <div className="ticket-pass ticket-pass__load-error" role="alert">
          <p>{t('ticket.pass.loadError')}</p>
          <button type="button" onClick={() => window.location.reload()}>{t('ticket.pass.retry')}</button>
        </div> : <div className="spinner" aria-hidden="true" />}
      </div>
    )
  }

  const canLeave = ticket.status === 'waiting' || ticket.status === 'called' || ticket.status === 'confirmed'

  return (
    <div className={`ticket-page ticket-page--${ticket.status}`}>
      <div className="ticket-pass">
      <header className="ticket-pass__header">
        <p className="ticket-pass__organization">{ticket.organization_name}</p>
        <p className="ticket-pass__queue">{ticket.queue_name}</p>
      </header>
      {canLeave && ticket.queue_status !== 'open' && (
        <div className={`ticket-page__banner ticket-page__banner--${ticket.queue_status}`}>
          {t(`ticket.queueStatus.${ticket.queue_status}`)}
        </div>
      )}

      <section className="ticket-pass__hero" aria-label={t('ticket.pass.numberLabel')}>
        <span className="ticket-pass__number-label">{t('ticket.pass.numberLabel')}</span>
        <strong className="ticket-page__number">{ticket.display_number}</strong>
        <p className="ticket-pass__state" role="status" aria-live="polite">{t(`ticket.status.${ticket.status}`)}</p>
      </section>

      <StatusBlock ticket={ticket} onRated={setTicket} />

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

      {canLeave && <PushOptInBanner />}
      {canLeave && id && <TelegramTicketBanner ticketId={id} />}
      </div>
    </div>
  )
}

function StatusBlock({
  ticket,
  onRated,
}: {
  ticket: TicketDetail
  onRated: (ticket: TicketDetail) => void
}) {
  const { t } = useTranslation()

  if (ticket.status === 'waiting') {
    return (
      <section className="ticket-pass__details" aria-label={t('ticket.pass.details')}>
        {ticket.position != null && <div className="ticket-pass__position">
          <span>{t('ticket.pass.position')}</span><strong>{ticket.position}</strong>
        </div>}
        {ticket.now_serving && <div className="ticket-pass__detail-row">
          <span>{t('ticket.pass.nowServing')}</span><strong>{ticket.now_serving}</strong>
        </div>}
        {ticket.estimated_wait_seconds != null && <div className="ticket-pass__detail-row">
          <span>{t('ticket.pass.estimatedWait')}</span><strong>{t('ticket.pass.minutes', { count: Math.max(1, Math.round(ticket.estimated_wait_seconds / 60)) })}</strong>
        </div>}
        <p className="ticket-pass__help">{t('ticket.pass.waitHint')}</p>
      </section>
    )
  }

  if (ticket.status === 'called' || ticket.status === 'confirmed' || ticket.status === 'serving') {
    return <section className="ticket-pass__destination" aria-label={t('ticket.pass.destination')}>
      {ticket.cabinet ? <><span>{t('ticket.pass.destination')}</span><strong>{ticket.cabinet.label}</strong></> : <p>{t('ticket.pass.waitForCabinet')}</p>}
      {ticket.status === 'called' && <p>{t('ticket.pass.confirmHint')}</p>}
    </section>
  }

  if (ticket.status === 'served') {
    return (
      <div className="ticket-pass__completion">
        {ticket.rating == null ? (
          <RatingForm ticketId={ticket.id} onSubmitted={onRated} />
        ) : (
          <p className="ticket-page__rating-thanks">{t('ticket.rating.thanks')}</p>
        )}
      </div>
    )
  }

  return null
}
