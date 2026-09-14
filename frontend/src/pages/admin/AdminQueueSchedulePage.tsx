import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { getQueue, getQueueSchedule, replaceQueueSchedule } from '../../api/queues'
import type { AdminQueue } from '../../api/types'
import ToastStack from '../../components/ToastStack'
import { useToasts } from '../../hooks/useToasts'
import { apiErrorMessage } from '../../lib/apiError'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

interface DayRow {
  open: boolean
  opensAt: string
  closesAt: string
}

function defaultRow(): DayRow {
  return { open: false, opensAt: '09:00', closesAt: '18:00' }
}

export default function AdminQueueSchedulePage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toasts, push, dismiss } = useToasts()
  const [queue, setQueue] = useState<AdminQueue | null>(null)
  const [rows, setRows] = useState<DayRow[]>(WEEKDAYS.map(defaultRow))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([getQueue(id), getQueueSchedule(id)])
      .then(([queueData, schedule]) => {
        setQueue(queueData)
        setRows(
          WEEKDAYS.map((weekday) => {
            const entry = schedule.find((e) => e.weekday === weekday)
            return entry
              ? { open: true, opensAt: entry.opens_at.slice(0, 5), closesAt: entry.closes_at.slice(0, 5) }
              : defaultRow()
          }),
        )
      })
      .catch(() => navigate('/admin/queues', { replace: true }))
      .finally(() => setLoading(false))
  }, [id, navigate])

  function updateRow(index: number, changes: Partial<DayRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...changes } : row)))
  }

  async function handleSave() {
    if (!id) return
    setSaving(true)
    try {
      const schedule = WEEKDAYS.filter((weekday) => rows[weekday].open).map((weekday) => ({
        weekday,
        opens_at: `${rows[weekday].opensAt}:00`,
        closes_at: `${rows[weekday].closesAt}:00`,
      }))
      await replaceQueueSchedule(id, schedule)
      push(t('admin.schedule.saved'))
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !queue) {
    return (
      <div className="admin-page">
        <div className="spinner" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="admin-page">
      <Link to="/admin/queues" className="admin-page__back">
        {t('admin.schedule.back')}
      </Link>
      <h1>{t('admin.schedule.title', { name: queue.name })}</h1>
      <p className="admin-page__hint">
        {t(WEEKDAYS.some((weekday) => rows[weekday].open) ? 'admin.schedule.hint' : 'admin.schedule.hintUnrestricted')}
      </p>

      <table className="admin-table admin-schedule__table">
        <thead>
          <tr>
            <th>{t('admin.schedule.columns.day')}</th>
            <th>{t('admin.schedule.columns.open')}</th>
            <th>{t('admin.schedule.columns.opensAt')}</th>
            <th>{t('admin.schedule.columns.closesAt')}</th>
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((weekday) => (
            <tr key={weekday}>
              <td>{t(`admin.analytics.weekdays.${WEEKDAY_KEYS[weekday]}`)}</td>
              <td>
                <input
                  type="checkbox"
                  checked={rows[weekday].open}
                  onChange={(e) => updateRow(weekday, { open: e.target.checked })}
                />
              </td>
              <td>
                <input
                  type="time"
                  value={rows[weekday].opensAt}
                  disabled={!rows[weekday].open}
                  onChange={(e) => updateRow(weekday, { opensAt: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="time"
                  value={rows[weekday].closesAt}
                  disabled={!rows[weekday].open}
                  onChange={(e) => updateRow(weekday, { closesAt: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="admin-page__actions">
        <button type="button" onClick={() => void handleSave()} disabled={saving}>
          {t('admin.schedule.save')}
        </button>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
