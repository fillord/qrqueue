import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { getMyTickets } from '../../api/public'
import { rememberTicketId } from '../../lib/ticketStorage'

/**
 * Restoration flow (ARCHITECTURE.md section 9, step 3 item 8): landing with
 * no token in the URL just means "check the device's cookie for an active
 * ticket first" before showing the placeholder.
 */
export default function LandingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function restore() {
      try {
        const tickets = await getMyTickets()
        if (!cancelled && tickets.length > 0) {
          rememberTicketId(tickets[0].id)
          navigate(`/t/${tickets[0].id}`, { replace: true })
          return
        }
      } catch {
        // no cookie yet, or a network hiccup — just show the landing page
      }
      if (!cancelled) setChecked(true)
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (!checked) {
    return (
      <div className="landing-page">
        <div className="spinner" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="landing-page">
      <h1 className="landing-page__title">{t('landing.title')}</h1>
      <p className="landing-page__subtitle">{t('landing.subtitle')}</p>
    </div>
  )
}
