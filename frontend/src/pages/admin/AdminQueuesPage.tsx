import LoadError from '../../components/LoadError'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { archiveQueue, createQueue, listQueues, restoreQueue, updateQueue } from '../../api/queues'
import type { QueueCreatePayload, QueueUpdatePayload } from '../../api/queues'
import type { AdminQueue, QueueStatus } from '../../api/types'
import StatusBadge from '../../components/StatusBadge'
import ToastStack from '../../components/ToastStack'
import { useToasts } from '../../hooks/useToasts'
import { apiErrorMessage } from '../../lib/apiError'
import QueueFormModal from './QueueFormModal'

const STATUS_TONE: Record<QueueStatus, 'success' | 'warning' | 'danger'> = {
  open: 'success',
  paused: 'warning',
  closed: 'danger',
}

export default function AdminQueuesPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loadError, setLoadError] = useState(false)
  const { toasts, push, dismiss } = useToasts()
  const [queues, setQueues] = useState<AdminQueue[] | null>(null)
  const [editing, setEditing] = useState<AdminQueue | null | 'new'>(null)
  const [includeArchived, setIncludeArchived] = useState(false)

  async function load() {
    setLoadError(false)
    try {
    setQueues(await listQueues(includeArchived))
    } catch { setLoadError(true) }
  }

  useEffect(() => {
    void load()
  }, [includeArchived])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setEditing('new')
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('new')
      return next
    }, { replace: true })
  }, [searchParams, setSearchParams])

  async function handleArchive(queue: AdminQueue) {
    if (!window.confirm(t('crud.archiveQueueConfirm', { name: queue.name }))) return
    try { await archiveQueue(queue.id); await load() }
    catch (err) { push(apiErrorMessage(err, t)) }
  }

  async function handleRestore(queue: AdminQueue) {
    try { await restoreQueue(queue.id); push(t('crud.restoreHint')); await load() }
    catch (err) { push(apiErrorMessage(err, t)) }
  }

  async function handleSubmit(payload: QueueCreatePayload | QueueUpdatePayload) {
    try {
      if (editing === 'new') {
        await createQueue(payload as QueueCreatePayload)
      } else if (editing) {
        await updateQueue(editing.id, payload)
      }
      setEditing(null)
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  async function handleStatusChange(queue: AdminQueue, status: QueueStatus) {
    if (status === queue.status) return
    try {
      await updateQueue(queue.id, { status })
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  async function toggleActive(queue: AdminQueue) {
    try {
      await updateQueue(queue.id, queue.is_active
        ? { is_active: false, status: 'closed' }
        : { is_active: true, status: 'open' })
      await load()
    } catch (err) { push(apiErrorMessage(err, t)) }
  }

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1>{t('admin.queues.title')}</h1>
        <div className="admin-page__header-actions">
          <button type="button" className="admin-button--secondary" onClick={() => setIncludeArchived(!includeArchived)}>{t(includeArchived ? 'crud.hideArchived' : 'crud.showArchived')}</button>
          <button type="button" data-assistant-tour="create-queue" onClick={() => setEditing('new')}>{t('admin.queues.create')}</button>
        </div>
      </div>

      {queues === null ? (
        loadError ? null : <div className="spinner" aria-hidden="true" />
      ) : queues.length === 0 ? (
        <p className="admin-page__empty">{t('admin.queues.empty')}</p>
      ) : (
        <table className="admin-table" data-assistant-tour="queue-list">
          <thead>
            <tr>
              <th>{t('admin.queues.columns.name')}</th>
              <th>{t('admin.queues.columns.prefix')}</th>
              <th>{t('admin.queues.columns.status')}</th>
              <th>{t('admin.queues.columns.waiting')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {queues.map((queue) => (
              <tr key={queue.id}>
                <td>{queue.name}{queue.deleted_at ? ` (${t('crud.archived')})` : !queue.is_active ? ` (${t('admin.users.inactive')})` : ''}</td>
                <td>
                  <code>{queue.ticket_prefix}</code>
                </td>
                <td>
                  <div className="admin-queues__status-cell">
                    <StatusBadge tone={queue.deleted_at ? 'neutral' : STATUS_TONE[queue.status]} label={queue.deleted_at ? t('crud.archived') : t(`admin.queues.status.${queue.status}`)} />
                    <select
                      value={queue.status}
                      disabled={!!queue.deleted_at}
                      onChange={(e) => void handleStatusChange(queue, e.target.value as QueueStatus)}
                    >
                      <option value="open">{t('admin.queues.status.open')}</option>
                      <option value="paused">{t('admin.queues.status.paused')}</option>
                      <option value="closed">{t('admin.queues.status.closed')}</option>
                    </select>
                  </div>
                </td>
                <td>{queue.waiting_count}</td>
                <td className="admin-table__actions">
                  {queue.deleted_at ? <button type="button" onClick={() => void handleRestore(queue)}>{t('crud.restore')}</button> : <>
                    <button type="button" onClick={() => setEditing(queue)}>{t('admin.queues.edit')}</button>
                    <button type="button" onClick={() => void toggleActive(queue)}>{t(queue.is_active ? 'admin.users.deactivate' : 'admin.users.activate')}</button>
                    <Link to={`/admin/queues/${queue.id}/schedule`}>{t('admin.queues.schedule')}</Link>
                    <button type="button" className="admin-action--danger" onClick={() => void handleArchive(queue)}>{t('crud.archive')}</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <QueueFormModal
          queue={editing === 'new' ? null : editing}
          onSubmit={handleSubmit}
          onClose={() => setEditing(null)}
        />
      )}

      {loadError && <LoadError retry={() => void load()} />}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
