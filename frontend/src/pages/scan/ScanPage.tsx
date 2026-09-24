import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { ApiError } from '../../api/client'
import { getMyTickets, getScanOptions, scan } from '../../api/public'
import type { ScanOptions } from '../../api/types'
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
  'queue_unavailable',
] as const

/**
 * /q — direct queue QR joins immediately; a hall QR first exchanges its
 * short-lived code for a scoped selection token and lists this TV's queues.
 */
export default function ScanPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t')
  const isHall = searchParams.get('mode') === 'hall'
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [options, setOptions] = useState<ScanOptions | null>(null)
  const [joining, setJoining] = useState(false)
  const startedRef = useRef(false)

  const joinQueue = useCallback(async (scanToken: string, queueId?: string) => {
    setJoining(true)
    const coords = await getGeolocation()
    try {
      const ticket = await scan({ token: scanToken, queue_id: queueId, lat: coords?.lat, lng: coords?.lng })
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
    } finally {
      setJoining(false)
    }
  }, [navigate])

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

    async function loadOptions(t0: string) {
      try {
        setOptions(await getScanOptions(t0))
      } catch (err) {
        setErrorCode(err instanceof ApiError ? err.code : 'unknown_error')
      }
    }

    if (!token) {
      void restoreWithoutToken()
    } else {
      if (isHall) void loadOptions(token)
      else void joinQueue(token)
    }
  }, [token, navigate, isHall, joinQueue])

  if (errorCode) {
    const key = (KNOWN_ERROR_CODES as readonly string[]).includes(errorCode)
      ? errorCode
      : 'unknown_error'

    return (
      <div className="scan-page scan-page--error">
        <p className="scan-page__message">{t(`scan.errors.${key}`)}</p>
        {key === 'token_expired' && <p className="scan-page__hint">{t('scan.hints.rescan')}</p>}
        {options && !['token_invalid', 'token_expired', 'token_not_yet_valid', 'queue_unavailable'].includes(key) &&
          <button className="scan-page__back" type="button" onClick={() => setErrorCode(null)}>{t('scan.choose.back')}</button>}
      </div>
    )
  }

  if (options) {
    return <div className="scan-page scan-page--choose">
      <p className="scan-page__eyebrow">{options.organization_name}</p>
      <h1>{t('scan.choose.title')}</h1>
      <p className="scan-page__hint">{t('scan.choose.hint')}</p>
      <div className="scan-page__queues">
        {options.queues.map((queue) => <button key={queue.id} type="button" disabled={joining || queue.unavailable_reason !== null} onClick={() => void joinQueue(options.selection_token, queue.id)}>
          <span>{queue.name}</span>
          {queue.unavailable_reason && <small>{t(`scan.errors.${queue.unavailable_reason}`)}</small>}
        </button>)}
      </div>
      {joining && <p role="status">{t('scan.joining')}</p>}
    </div>
  }

  return (
    <div className="scan-page">
      <div className="spinner" aria-hidden="true" />
      <p className="scan-page__message">{t('scan.joining')}</p>
    </div>
  )
}
