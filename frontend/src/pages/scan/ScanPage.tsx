import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { ApiError } from '../../api/client'
import { getMyTickets, scan } from '../../api/public'
import { getGeolocation } from '../../lib/geolocation'
import { rememberTicketId } from '../../lib/ticketStorage'

const KNOWN_ERROR_CODES = [
  'token_invalid',
  'token_expired',
  'token_not_yet_valid',
  'queue_closed',
  'queue_paused',
  'outside_schedule',
  'daily_limit_reached',
  'geo_required',
  'geo_out_of_range',
  'rate_limited',
] as const

/**
 * /q — scan page. Reads ?t=, requests geolocation with an 8s timeout, then
 * always calls POST /api/public/scan (with or without coordinates) — the
 * backend, not this page, decides whether coordinates were required.
 */
export default function ScanPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    async function restoreWithoutToken() {
      try {
        const tickets = await getMyTickets()
        if (tickets.length > 0) {
          rememberTicketId(tickets[0].id)
          navigate(`/t/${tickets[0].id}`, { replace: true })
          return
        }
      } catch {
        // no cookie yet / network hiccup — nothing to restore, go to landing
      }
      navigate('/', { replace: true })
    }

    async function runScan(t0: string) {
      const coords = await getGeolocation()
      try {
        const ticket = await scan({ token: t0, lat: coords?.lat, lng: coords?.lng })
        rememberTicketId(ticket.id)
        navigate(`/t/${ticket.id}`, { replace: true })
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === 'already_in_queue' && err.ticketId) {
            rememberTicketId(err.ticketId)
            navigate(`/t/${err.ticketId}`, { replace: true })
            return
          }
          setErrorCode(err.code)
        } else {
          setErrorCode('unknown_error')
        }
      }
    }

    if (!token) {
      void restoreWithoutToken()
    } else {
      void runScan(token)
    }
  }, [token, navigate])

  if (errorCode) {
    const key = (KNOWN_ERROR_CODES as readonly string[]).includes(errorCode)
      ? errorCode
      : 'unknown_error'

    return (
      <div className="scan-page scan-page--error">
        <p className="scan-page__message">{t(`scan.errors.${key}`)}</p>
        {key === 'token_expired' && <p className="scan-page__hint">{t('scan.hints.rescan')}</p>}
      </div>
    )
  }

  return (
    <div className="scan-page">
      <div className="spinner" aria-hidden="true" />
      <p className="scan-page__message">{t('scan.joining')}</p>
    </div>
  )
}
