import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { getMyTickets } from '../../api/public'
import type { TicketDetail } from '../../api/types'
import { useTicket } from '../../hooks/useTicket'
import { forgetTicketId, rememberTicketId } from '../../lib/ticketStorage'

/**
 * /t/:id — ticket page. Polls via useTicket (see that hook's docstring for
 * why polling, not sockets, for now).
 *
 * NOTE: for the `called` status, ARCHITECTURE.md section 9 step 3 asks for
 * "Вас вызывают, подойдите к <кабинет>" — but /api/public/tickets/:id (step 3
 * backend, frozen for this task) doesn't expose the cabinet's label, only
 * ticket/queue fields. The message below is generic until that's added.
 */
export default function TicketPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { ticket, loading, notFound } = useTicket(id)

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

  return (
    <div className="ticket-page">
      {ticket.queue_status !== 'open' && (
        <div className={`ticket-page__banner ticket-page__banner--${ticket.queue_status}`}>
          {t(`ticket.queueStatus.${ticket.queue_status}`)}
        </div>
      )}

      <div className="ticket-page__number">{ticket.display_number}</div>

      <StatusBlock ticket={ticket} />

      {/* "я здесь" и "выйти" — шаг 6 */}
      <div className="ticket-page__actions" />
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

  if (ticket.status === 'called') {
    return (
      <div className="ticket-page__info ticket-page__info--called">
        <p className="ticket-page__called-message">{t('ticket.status.called')}</p>
      </div>
    )
  }

  return <p className="ticket-page__status">{t(`ticket.status.${ticket.status}`)}</p>
}
