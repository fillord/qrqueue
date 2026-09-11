import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { createQueue, listQueues, updateQueue } from '../../api/queues'
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
  const { toasts, push, dismiss } = useToasts()
  const [queues, setQueues] = useState<AdminQueue[] | null>(null)
  const [editing, setEditing] = useState<AdminQueue | null | 'new'>(null)

  async function load() {
    setQueues(await listQueues())
  }

  useEffect(() => {
    void load()
  }, [])

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

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1>{t('admin.queues.title')}</h1>
        <button type="button" onClick={() => setEditing('new')}>
          {t('admin.queues.create')}
        </button>
      </div>

      {queues === null ? (
        <div className="spinner" aria-hidden="true" />
      ) : queues.length === 0 ? (
        <p className="admin-page__empty">{t('admin.queues.empty')}</p>
      ) : (
        <table className="admin-table">
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
                <td>{queue.name}</td>
                <td>
                  <code>{queue.ticket_prefix}</code>
                </td>
                <td>
                  <div className="admin-queues__status-cell">
                    <StatusBadge tone={STATUS_TONE[queue.status]} label={t(`admin.queues.status.${queue.status}`)} />
                    <select
                      value={queue.status}
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
                  <button type="button" onClick={() => setEditing(queue)}>
                    {t('admin.queues.edit')}
                  </button>
                  <Link to={`/admin/queues/${queue.id}/schedule`}>{t('admin.queues.schedule')}</Link>
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

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
