import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { createTvScreen, deleteTvScreen, getAdminQueues, getTvScreens } from '../../api/admin'
import type { QueueSummary, TvScreen } from '../../api/types'

/**
 * /admin/tv-screens (org_admin, own org) and, embedded with an explicit
 * `organizationId`, the tv-screens section of /sa/organizations/:id
 * (superadmin, any org) — same backend routes, `?organization_id=` is all
 * that differs (see api/admin.ts), so one component covers both contexts
 * instead of duplicating this CRUD UI.
 */
export default function AdminTvScreensPage({ organizationId }: { organizationId?: string }) {
  const { t } = useTranslation()
  const [screens, setScreens] = useState<TvScreen[] | null>(null)
  const [queues, setQueues] = useState<QueueSummary[]>([])
  const [name, setName] = useState('')
  const [queueId, setQueueId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)

  async function load() {
    const [screenList, queueList] = await Promise.all([
      getTvScreens(organizationId),
      getAdminQueues(organizationId),
    ])
    setScreens(screenList)
    setQueues(queueList)
  }

  useEffect(() => {
    void load()
  }, [organizationId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(false)
    try {
      await createTvScreen({ name: name.trim(), queue_id: queueId || null }, organizationId)
      setName('')
      setQueueId('')
      await load()
    } catch {
      setError(true)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    await deleteTvScreen(id, organizationId)
    await load()
  }

  return (
    <div className="admin-tv-screens">
      <h1>{t('adminTv.title')}</h1>

      <form className="admin-tv-screens__form" onSubmit={(e) => void handleSubmit(e)}>
        <input
          type="text"
          placeholder={t('adminTv.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select value={queueId} onChange={(e) => setQueueId(e.target.value)}>
          <option value="">{t('adminTv.noQueue')}</option>
          {queues.map((queue) => (
            <option key={queue.id} value={queue.id}>
              {queue.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={submitting || !name.trim()}>
          {t('adminTv.create')}
        </button>
      </form>

      {error && <p className="admin-tv-screens__error">{t('adminTv.error')}</p>}

      {screens === null ? (
        <div className="spinner" aria-hidden="true" />
      ) : screens.length === 0 ? (
        <p>{t('adminTv.empty')}</p>
      ) : (
        <table className="admin-tv-screens__table">
          <thead>
            <tr>
              <th>{t('adminTv.columns.name')}</th>
              <th>{t('adminTv.columns.queue')}</th>
              <th>{t('adminTv.columns.pairingCode')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {screens.map((screen) => (
              <tr key={screen.id}>
                <td>{screen.name}</td>
                <td>{queues.find((q) => q.id === screen.queue_id)?.name ?? t('adminTv.noQueue')}</td>
                <td>
                  {screen.pairing_code ? (
                    <code className="admin-tv-screens__code">{screen.pairing_code}</code>
                  ) : (
                    t('adminTv.paired')
                  )}
                </td>
                <td>
                  <button type="button" onClick={() => void handleDelete(screen.id)}>
                    {t('adminTv.delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
