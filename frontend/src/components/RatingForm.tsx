import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { rateTicket } from '../api/public'
import type { TicketDetail } from '../api/types'

const STARS = [1, 2, 3, 4, 5]

export default function RatingForm({
  ticketId,
  onSubmitted,
}: {
  ticketId: string
  onSubmitted: (ticket: TicketDetail) => void
}) {
  const { t } = useTranslation()
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (rating < 1) return
    setSubmitting(true)
    setError(false)
    try {
      const updated = await rateTicket(ticketId, rating, comment.trim() || undefined)
      onSubmitted(updated)
    } catch {
      setError(true)
    } finally {
      setSubmitting(false)
    }
  }

  const shownRating = hoverRating || rating

  return (
    <form className="rating-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="rating-form__title">{t('ticket.rating.title')}</p>

      <div className="rating-form__stars">
        {STARS.map((value) => (
          <button
            key={value}
            type="button"
            className={`rating-form__star${shownRating >= value ? ' rating-form__star--filled' : ''}`}
            onClick={() => setRating(value)}
            onMouseEnter={() => setHoverRating(value)}
            onMouseLeave={() => setHoverRating(0)}
            aria-label={t('ticket.rating.starLabel', { value })}
          >
            ★
          </button>
        ))}
      </div>

      <textarea
        className="rating-form__comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t('ticket.rating.commentPlaceholder')}
      />

      <button type="submit" disabled={rating < 1 || submitting}>
        {t('ticket.rating.submit')}
      </button>

      {error && <p className="rating-form__error">{t('ticket.rating.error')}</p>}
    </form>
  )
}
