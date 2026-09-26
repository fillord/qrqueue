import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError } from '../../api/client'
import { createRegistrarTicket, getRegistrarQueues } from '../../api/registrar'
import type { QueueSummary, TicketSummary } from '../../api/types'

const DISPLAY_SECONDS = 8
const KNOWN_ERRORS = ['queue_closed', 'queue_paused', 'outside_schedule', 'daily_limit_reached'] as const

interface RegisteredTicket {
  ticket: TicketSummary
  queueId: string
}

/**
 * /registrar — a registrar issues walk-in tickets by hand (no client
 * device involved). After each one, the number takes over the screen for
 * a few seconds so it can be read out or shown at the desk, then the list
 * comes back — "ещё раз" re-submits for the same queue for fast throughput.
 */
export default function RegistrarPage() {
  const { t } = useTranslation()
  const [queues, setQueues] = useState<QueueSummary[] | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyQueueId, setBusyQueueId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RegisteredTicket | null>(null)
  const [countdown, setCountdown] = useState(DISPLAY_SECONDS)

  async function load() {
    const list = await getRegistrarQueues()
    setQueues(list)
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!result) return undefined
    setCountdown(DISPLAY_SECONDS)
    const interval = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          setResult(null)
          return 0
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [result])

  async function register(queueId: string) {
    setBusyQueueId(queueId)
    setError(null)
    try {
      const ticket = await createRegistrarTicket(queueId, notes[queueId])
      setNotes((prev) => ({ ...prev, [queueId]: '' }))
      setResult({ ticket, queueId })
    } catch (err) {
      const code = err instanceof ApiError && (KNOWN_ERRORS as readonly string[]).includes(err.code)
        ? err.code
        : 'unknown_error'
      setError(t(`registrar.errors.${code}`))
    } finally {
      setBusyQueueId(null)
    }
  }

  if (result) {
    return (
      <div className="registrar-result">
        <p className="registrar-result__label">{t('registrar.result.label')}</p>
        <div className="registrar-result__number">{result.ticket.display_number}</div>
        <p className="registrar-result__hint">{t('registrar.result.hint')}</p>
        <div className="registrar-result__actions">
          <button
            type="button"
            disabled={busyQueueId === result.queueId}
            onClick={() => void register(result.queueId)}
          >
            {t('registrar.result.again')}
          </button>
          <button type="button" onClick={() => setResult(null)}>
            {t('registrar.result.done')}
          </button>
        </div>
        <p className="registrar-result__countdown">{t('registrar.result.countdown', { seconds: countdown })}</p>
      </div>
    )
  }

  return (
    <div className="registrar-page">
      <h1>{t('registrar.title')}</h1>

      {error && <p className="registrar-page__error">{error}</p>}

      {queues === null ? (
        <div className="spinner" aria-hidden="true" />
      ) : queues.length === 0 ? (
        <p>{t('registrar.empty')}</p>
      ) : (
        <div className="registrar-page__list">
          {queues.map((queue) => (
            <div key={queue.id} className="registrar-page__row">
              <div className="registrar-page__row-info">
                <span className="registrar-page__row-name">{queue.name}</span>
                {queue.status === 'paused' && (
                  <span className="registrar-page__row-paused">{t('registrar.paused')}</span>
                )}
              </div>
              <input
                type="text"
                aria-label={`${queue.name}: ${t('registrar.notePlaceholder')}`}
                placeholder={t('registrar.notePlaceholder')}
                value={notes[queue.id] ?? ''}
                onChange={(e) => setNotes((prev) => ({ ...prev, [queue.id]: e.target.value }))}
              />
              <button
                type="button"
                disabled={busyQueueId === queue.id || queue.status === 'paused'}
                onClick={() => void register(queue.id)}
              >
                {t('registrar.record')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
