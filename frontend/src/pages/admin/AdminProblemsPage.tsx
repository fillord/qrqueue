import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { getAdminProblems } from '../../api/admin'
import type { AdminProblem, AdminProblemsData } from '../../api/types'
import LoadError from '../../components/LoadError'

type Filter = 'all' | 'critical' | 'warning'

function actionPath(problem: AdminProblem): string {
  if (problem.code === 'screen_offline') return '/admin/tv-screens'
  if (problem.code === 'no_cabinet') return '/admin/cabinets'
  return '/admin/queues'
}

export default function AdminProblemsPage() {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState<AdminProblemsData | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    let cancelled = false
    function load() {
      void getAdminProblems().then((result) => {
        if (cancelled) return
        setData(result)
        setError(false)
      }).catch(() => { if (!cancelled) setError(true) })
    }
    load()
    const timer = window.setInterval(load, 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [retry])

  const problems = data?.items.filter((item) => filter === 'all' || item.severity === filter) ?? []
  const criticalCount = data?.items.filter((item) => item.severity === 'critical').length ?? 0
  const warningCount = data?.items.length ? data.items.length - criticalCount : 0

  return <div className="admin-page admin-problems">
    <header className="admin-page__header">
      <div><h1>{t('admin.problems.title')}</h1><p className="admin-page__hint">{t('admin.problems.intro')}</p></div>
      {data && <span className="admin-problems__updated">{t('admin.problems.updated', { time: new Date(data.generated_at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}</span>}
    </header>
    {error && <LoadError retry={() => setRetry((value) => value + 1)} />}
    {!data ? !error && <div className="spinner" aria-hidden="true" /> : <>
      <div className="admin-problems__filters" role="group" aria-label={t('admin.problems.filterLabel')}>
        {(['all', 'critical', 'warning'] as const).map((key) => <button key={key} type="button"
          className={filter === key ? 'admin-problems__filter admin-problems__filter--active' : 'admin-problems__filter'}
          aria-pressed={filter === key} onClick={() => setFilter(key)}>
          {t(`admin.problems.filters.${key}`, { count: key === 'all' ? data.items.length : key === 'critical' ? criticalCount : warningCount })}
        </button>)}
      </div>
      {data.items.length === 0 ? <div className="admin-problems__empty" role="status">
        <strong>{t('admin.problems.emptyTitle')}</strong><p>{t('admin.problems.emptyHint')}</p>
      </div> : problems.length === 0 ? <p className="admin-page__empty">{t('admin.problems.noMatches')}</p> :
        <ul className="admin-problems__list">{problems.map((item) => <li key={`${item.code}-${item.queue_id ?? item.screen_id}`} className={`admin-problems__item admin-problems__item--${item.severity}`}>
          <span className="admin-problems__marker" aria-hidden="true" />
          <div>
            <span className="admin-problems__severity">{t(`admin.problems.severity.${item.severity}`)}</span>
            <h2>{t(`admin.problems.kind.${item.code}.title`, { name: item.name })}</h2>
            <p>{t(`admin.problems.kind.${item.code}.detail`, { count: item.waiting_count ?? undefined, minutes: item.wait_minutes ?? undefined })}</p>
          </div>
          <Link to={actionPath(item)}>{t(`admin.problems.kind.${item.code}.action`)}</Link>
        </li>)}</ul>}
    </>}
  </div>
}
