import LoadError from '../../components/LoadError'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getAdminQueues, getAnalytics } from '../../api/admin'
import type { Analytics, QueueSummary } from '../../api/types'
import BarChart from '../../components/BarChart'
import { defaultDateRange } from '../../lib/formatDate'

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export default function AdminAnalyticsPage() {
  const { t } = useTranslation()
  const [retry, setRetry] = useState(0)
  const initial = defaultDateRange(7)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [queues, setQueues] = useState<QueueSummary[]>([])
  const [queueId, setQueueId] = useState('')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    void getAdminQueues().then(setQueues).catch(() => setError(true))
  }, [retry])

  useEffect(() => {
    setLoading(true)
    setError(false)
    getAnalytics({ from, to, queueId: queueId || undefined })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [retry, from, to, queueId])

  const weekdayLabels = WEEKDAY_KEYS.map((key) => t(`admin.analytics.weekdays.${key}`))

  function minutesLabel(seconds: number | null): string {
    return seconds != null ? t('admin.analytics.minutes', { minutes: Math.round(seconds / 60) }) : '—'
  }

  return (
    <div className="admin-page">
      <h1>{t('admin.analytics.title')}</h1>

      <div className="admin-filters">
        <label>
          <span>{t('admin.analytics.from')}</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span>{t('admin.analytics.to')}</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          <span>{t('admin.analytics.queue')}</span>
          <select value={queueId} onChange={(e) => setQueueId(e.target.value)}>
            <option value="">{t('admin.analytics.allQueues')}</option>
            {queues.map((queue) => (
              <option key={queue.id} value={queue.id}>
                {queue.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="admin-page__error">{t('admin.analytics.error')}</p>}

      {error ? <LoadError retry={() => setRetry((n) => n + 1)} /> : loading || !data ? (
        <div className="spinner" aria-hidden="true" />
      ) : (
        <>
          <div className="admin-analytics__cards">
            <div className="admin-analytics__card">
              <span className="admin-analytics__card-label">{t('admin.analytics.avgWait')}</span>
              <span className="admin-analytics__card-value">{minutesLabel(data.avg_wait_seconds)}</span>
            </div>
            <div className="admin-analytics__card">
              <span className="admin-analytics__card-label">{t('admin.analytics.avgServing')}</span>
              <span className="admin-analytics__card-value">{minutesLabel(data.avg_serving_seconds)}</span>
            </div>
            <div className="admin-analytics__card">
              <span className="admin-analytics__card-label">{t('admin.analytics.noShowRate')}</span>
              <span className="admin-analytics__card-value">
                {data.no_show_rate != null ? `${Math.round(data.no_show_rate * 100)}%` : '—'}
              </span>
            </div>
            <div className="admin-analytics__card">
              <span className="admin-analytics__card-label">{t('admin.analytics.avgRating')}</span>
              <span className="admin-analytics__card-value">
                {data.avg_rating != null
                  ? t('admin.analytics.ratingValue', { rating: data.avg_rating.toFixed(1), count: data.ratings_count })
                  : '—'}
              </span>
            </div>
          </div>

          <section className="admin-analytics__section">
            <h2>{t('admin.analytics.peaksByHour')}</h2>
            <BarChart data={data.peaks_by_hour.map((p) => ({ label: String(p.hour), value: p.count }))} />
          </section>

          <section className="admin-analytics__section">
            <h2>{t('admin.analytics.peaksByWeekday')}</h2>
            <BarChart
              data={data.peaks_by_weekday.map((p) => ({ label: weekdayLabels[p.weekday], value: p.count }))}
            />
          </section>

          <section className="admin-analytics__section">
            <h2>{t('admin.analytics.byOperator')}</h2>
            {data.by_operator.length === 0 ? (
              <p className="admin-page__empty">{t('admin.analytics.noData')}</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t('admin.analytics.columns.operator')}</th>
                    <th>{t('admin.analytics.columns.served')}</th>
                    <th>{t('admin.analytics.columns.avgServing')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_operator.map((op) => (
                    <tr key={op.operator_id}>
                      <td>{op.full_name}</td>
                      <td>{op.served_count}</td>
                      <td>{minutesLabel(op.avg_serving_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  )
}
