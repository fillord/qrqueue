import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../../api/client'
import {
  callNext,
  finishServing,
  getCabinets,
  getOperatorQueues,
  markNoShow,
  pauseCabinet,
  recallTicket,
  resumeCabinet,
  returnTicket,
  startServing,
  transferTicket,
} from '../../api/operator'
import type { OperatorTicket } from '../../api/types'
import ToastStack from '../../components/ToastStack'
import { useElapsedSeconds } from '../../hooks/useElapsedSeconds'
import { useOperatorQueue } from '../../hooks/useOperatorQueue'
import { useToasts } from '../../hooks/useToasts'
import { forgetCabinetId, getRememberedCabinetId } from '../../lib/operatorCabinet'
import { formatDuration, minutesSince } from '../../lib/time'
import PauseModal from './PauseModal'
import TransferModal from './TransferModal'

const KNOWN_ACTION_ERRORS = [
  'cabinet_busy',
  'queue_empty',
  'invalid_transition',
  'cabinet_has_no_queue',
  'active_ticket',
  'cabinet_not_paused',
  'target_queue_unavailable',
  'outside_schedule',
  'daily_limit_reached',
  'already_in_queue',
] as const

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

export default function OperatorQueuePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { queue, loading, cabinetNotSelected, refresh } = useOperatorQueue()
  const { toasts, push, dismiss } = useToasts()
  const [cabinetLabel, setCabinetLabel] = useState<string | null>(null)
  const [queueName, setQueueName] = useState<string | null>(null)
  const [transferTarget, setTransferTarget] = useState<OperatorTicket | null>(null)
  const [pauseModalOpen, setPauseModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const calledSeconds = useElapsedSeconds(queue?.current_ticket?.called_at ?? null)

  useEffect(() => {
    if (cabinetNotSelected) {
      forgetCabinetId()
      navigate('/operator', { replace: true })
    }
  }, [cabinetNotSelected, navigate])

  useEffect(() => {
    const rememberedId = getRememberedCabinetId()
    if (!rememberedId) return
    void getCabinets()
      .then((cabinets) => {
        const match = cabinets.find((c) => c.id === rememberedId)
        if (match) setCabinetLabel(match.label)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!queue) return
    void getOperatorQueues()
      .then((queues) => {
        const match = queues.find((q) => q.id === queue.queue_id)
        if (match) setQueueName(match.name)
      })
      .catch(() => undefined)
  }, [queue?.queue_id])

  const runAction = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true)
      try {
        const result = await action()
        refresh()
        return result
      } catch (err) {
        refresh()
        if (err instanceof ApiError) {
          const code = (KNOWN_ACTION_ERRORS as readonly string[]).includes(err.code)
            ? err.code
            : 'unknown_error'
          push(t(`operator.errors.${code}`))
        } else {
          push(t('operator.errors.unknown_error'))
        }
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [push, refresh, t],
  )

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!queue || busy || queue.cabinet_status === 'paused' || isTypingTarget(e.target)) return

      if (e.code === 'Space' && !queue.current_ticket) {
        e.preventDefault()
        void runAction(() => callNext())
      } else if (
        e.key === 'Enter' &&
        queue.current_ticket &&
        (queue.current_ticket.status === 'called' || queue.current_ticket.status === 'confirmed')
      ) {
        e.preventDefault()
        void runAction(() => startServing(queue.current_ticket!.id))
      } else if ((e.key === 'f' || e.key === 'F') && queue.current_ticket?.status === 'serving') {
        e.preventDefault()
        void runAction(() => finishServing(queue.current_ticket!.id))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [queue, busy, runAction])

  if (loading || !queue) {
    return (
      <div className="operator-queue">
        <div className="spinner" aria-hidden="true" />
      </div>
    )
  }

  const ticket = queue.current_ticket
  const paused = queue.cabinet_status === 'paused'

  return (
    <div className="operator-queue">
      <header className="operator-queue__header">
        <div className="operator-queue__header-info">
          <span className="operator-queue__cabinet">{cabinetLabel ?? '—'}</span>
          <span className="operator-queue__queue-name">{queueName ?? queue.queue_id}</span>
          <span className="operator-queue__waiting-count">
            {t('operator.header.waiting', { count: queue.waiting_count })}
          </span>
        </div>
        <button
          type="button"
          className={paused ? 'operator-queue__resume-btn' : 'operator-queue__pause-btn'}
          disabled={busy}
          onClick={() => (paused ? void runAction(() => resumeCabinet()) : setPauseModalOpen(true))}
        >
          {t(paused ? 'operator.header.resume' : 'operator.header.pause')}
        </button>
      </header>

      {paused && <div className="operator-queue__paused-banner">{t('operator.header.paused')}</div>}

      <div className={`operator-queue__body${paused ? ' operator-queue__body--dimmed' : ''}`}>
        <section className="operator-queue__current">
          {!ticket ? (
            <>
              <p className="operator-queue__empty">{t('operator.current.empty')}</p>
              <button
                type="button"
                disabled={busy || queue.waiting_count === 0}
                onClick={() => void runAction(() => callNext())}
              >
                {t('operator.actions.callNext')}
              </button>
            </>
          ) : (
            <>
              <div className="operator-queue__ticket-number">{ticket.display_number}</div>
              <p className="operator-queue__ticket-status">{t(`operator.current.status.${ticket.status}`)}</p>
              {ticket.status === 'confirmed' && (
                <p className="operator-queue__confirmed-badge">{t('operator.current.confirmedBadge')}</p>
              )}
              {calledSeconds !== null && (
                <p className="operator-queue__called-timer">
                  {t('operator.current.calledFor', { time: formatDuration(calledSeconds) })}
                </p>
              )}
              <p className="operator-queue__call-count">
                {t('operator.current.callCount', { count: ticket.call_count })}
              </p>

              <div className="operator-queue__actions">
                {ticket.status === 'called' && (
                  <button type="button" disabled={busy} onClick={() => void runAction(() => recallTicket(ticket.id))}>
                    {t('operator.actions.recall')}
                  </button>
                )}
                {(ticket.status === 'called' || ticket.status === 'confirmed') && (
                  <>
                    <button type="button" disabled={busy} onClick={() => void runAction(() => markNoShow(ticket.id))}>
                      {t('operator.actions.noShow')}
                    </button>
                    <button type="button" disabled={busy} onClick={() => void runAction(() => startServing(ticket.id))}>
                      {t('operator.actions.start')}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setTransferTarget(ticket)}>
                      {t('operator.actions.transfer')}
                    </button>
                  </>
                )}
                {ticket.status === 'serving' && (
                  <button type="button" disabled={busy} onClick={() => void runAction(() => finishServing(ticket.id))}>
                    {t('operator.actions.finish')}
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <section className="operator-queue__side">
          <div className="operator-queue__waiting">
            <h2>{t('operator.waiting.title')}</h2>
            {queue.waiting.length === 0 ? (
              <p className="operator-queue__empty">{t('operator.waiting.empty')}</p>
            ) : (
              <ul>
                {queue.waiting.map((item) => (
                  <li key={item.id}>
                    <span>{item.display_number}</span>
                    <span>{t('operator.waiting.waitingFor', { minutes: minutesSince(item.created_at) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <details className="operator-queue__no-show">
            <summary>{t('operator.noShow.title')} · {queue.no_show.length}</summary>
            {queue.no_show.length === 0 ? (
              <p className="operator-queue__empty">{t('operator.noShow.empty')}</p>
            ) : (
              <ul>
                {queue.no_show.map((item) => (
                  <li key={item.id}>
                    <span>{item.display_number}</span>
                    <button type="button" disabled={busy} onClick={() => void runAction(() => returnTicket(item.id))}>
                      {t('operator.noShow.return')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </section>
      </div>

      <footer className="operator-queue__hotkeys">{t('operator.hotkeys')}</footer>

      {transferTarget && (
        <TransferModal
          currentQueueId={queue.queue_id}
          onClose={() => setTransferTarget(null)}
          onConfirm={(queueId) => {
            const target = transferTarget
            setTransferTarget(null)
            void runAction(() => transferTicket(target.id, queueId))
          }}
        />
      )}

      {pauseModalOpen && (
        <PauseModal
          onClose={() => setPauseModalOpen(false)}
          onConfirm={(reason) => {
            setPauseModalOpen(false)
            void runAction(() => pauseCabinet(reason))
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
