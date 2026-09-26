import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getDailyReport } from '../../api/admin'
import type { DailyReportData } from '../../api/types'
import LoadError from '../../components/LoadError'

function minutes(seconds: number | null): string {
  return seconds === null ? '—' : String(Math.round(seconds / 60))
}

export default function AdminDailyReportPage() {
  const { t, i18n } = useTranslation()
  const [selectedDay, setSelectedDay] = useState('')
  const [data, setData] = useState<DailyReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    void getDailyReport(selectedDay || undefined).then((result) => {
      if (!cancelled) setData(result)
    }).catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedDay, retry])

  const day = selectedDay || data?.day || ''
  const reportLanguage = ['ru', 'en', 'kk'].includes(i18n.language.split('-')[0]) ? i18n.language.split('-')[0] : 'ru'
  return <div className="admin-page admin-report">
    <div className="admin-page__header">
      <div><h1>{t('admin.report.title')}</h1><p className="admin-page__hint">{t('admin.report.intro')}</p></div>
      <div className="admin-report__controls">
        <label>{t('admin.report.day')}<input type="date" value={day} onChange={(event) => setSelectedDay(event.target.value)} /></label>
        {data && !error && !loading && <a className="admin-report__download" href={`/api/admin/daily-report.xlsx?day=${encodeURIComponent(day)}&lang=${reportLanguage}`} download>
          {t('admin.report.download')}
        </a>}
      </div>
    </div>
    {error && <LoadError retry={() => setRetry((value) => value + 1)} />}
    {loading ? <div className="spinner" aria-hidden="true" /> : data && !error && <>
      <p className="admin-report__timezone">{t('admin.report.timezone', { timezone: data.timezone })}</p>
      <div className="admin-report__totals">
        {(['issued_count', 'served_count', 'no_show_count', 'left_count', 'active_count'] as const).map((key) => <div key={key}>
          <strong>{data[key]}</strong><span>{t(`admin.report.metrics.${key}`)}</span>
        </div>)}
      </div>
      <p className="admin-report__averages">{t('admin.report.averages', { wait: minutes(data.avg_wait_seconds), service: minutes(data.avg_serving_seconds) })}</p>
      <section className="admin-report__section">
        <h2>{t('admin.report.queuesTitle')}</h2>
        {data.by_queue.length === 0 ? <p className="admin-page__empty">{t('admin.report.empty')}</p> : <div className="dashboard-table-scroll" role="region" aria-label={t('admin.report.queuesTitle')} tabIndex={0}>
          <table className="admin-table admin-report__table"><thead><tr>
            {(['queue', 'issued_count', 'served_count', 'no_show_count', 'left_count', 'active_count', 'avg_wait'] as const).map((key) => <th key={key}>{t(`admin.report.columns.${key}`)}</th>)}
          </tr></thead><tbody>{data.by_queue.map((row) => <tr key={row.queue_id}>
            <td>{row.name}</td><td>{row.issued_count}</td><td>{row.served_count}</td><td>{row.no_show_count}</td><td>{row.left_count}</td><td>{row.active_count}</td><td>{minutes(row.avg_wait_seconds)}</td>
          </tr>)}</tbody></table>
        </div>}
      </section>
      <details className="admin-report__operators">
        <summary>{t('admin.report.operatorsTitle', { count: data.by_operator.length })}</summary>
        {data.by_operator.length === 0 ? <p className="admin-page__empty">{t('admin.report.noOperators')}</p> : <div className="dashboard-table-scroll" role="region" aria-label={t('admin.report.operatorsLabel')} tabIndex={0}>
          <table className="admin-table"><thead><tr><th>{t('admin.report.columns.operator')}</th><th>{t('admin.report.columns.served_count')}</th></tr></thead>
            <tbody>{data.by_operator.map((row) => <tr key={row.operator_id}><td>{row.full_name}</td><td>{row.served_count}</td></tr>)}</tbody></table>
        </div>}
      </details>
      <p className="admin-report__footnote">{t('admin.report.footnote')}</p>
    </>}
  </div>
}
