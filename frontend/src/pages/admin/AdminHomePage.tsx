import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { getAdminHome } from '../../api/admin'
import type { AdminHomeData } from '../../api/types'
import LoadError from '../../components/LoadError'

type StepKey = 'queue' | 'cabinet' | 'operator' | 'assignment' | 'screen'

const STEP_LINKS: Record<StepKey, string> = {
  queue: '/admin/queues?new=1',
  cabinet: '/admin/cabinets?new=1',
  operator: '/admin/users?new=1',
  assignment: '/admin/cabinets?assign=1',
  screen: '/admin/tv-screens',
}

const STEP_KEYS: StepKey[] = ['queue', 'cabinet', 'operator', 'assignment', 'screen']

function SetupList({ data }: { data: AdminHomeData }) {
  const { t } = useTranslation()
  const completed: Record<StepKey, boolean> = {
    queue: data.queues.length > 0,
    cabinet: data.cabinet_count > 0,
    operator: data.operator_count > 0,
    assignment: data.has_operator_assignment,
    screen: data.paired_queue_screen_count > 0,
  }
  const doneCount = STEP_KEYS.filter((key) => completed[key]).length
  const nextStep = STEP_KEYS.find((key) => !completed[key])

  return <div className="admin-home__setup">
    <div className="admin-home__setup-heading">
      <div>
        <h2>{t('admin.home.setupTitle')}</h2>
        <p>{t('admin.home.setupIntro')}</p>
      </div>
      <span className="admin-home__progress-text">{t('admin.home.progress', { done: doneCount, total: STEP_KEYS.length })}</span>
    </div>
    <progress className="admin-home__progress" value={doneCount} max={STEP_KEYS.length} aria-label={t('admin.home.progress', { done: doneCount, total: STEP_KEYS.length })} />
    <ol className="admin-home__steps">
      {STEP_KEYS.map((key, index) => <li key={key} className={`admin-home__step${completed[key] ? ' admin-home__step--done' : key === nextStep ? ' admin-home__step--next' : ''}`}>
        <span className="admin-home__step-number" aria-hidden="true">{completed[key] ? '✓' : index + 1}</span>
        <div className="admin-home__step-copy">
          <h3>{t(`admin.home.steps.${key}.title`)}</h3>
          <p>{t(`admin.home.steps.${key}.description`)}</p>
          <span className="admin-home__step-state">{t(completed[key] ? 'admin.home.done' : key === nextStep ? 'admin.home.nextStep' : 'admin.home.pending')}</span>
        </div>
        <Link className={key === nextStep ? 'admin-home__step-link admin-home__step-link--primary' : 'admin-home__step-link'} to={STEP_LINKS[key]}>
          {t(`admin.home.steps.${key}.action`)}
        </Link>
      </li>)}
    </ol>
  </div>
}

export default function AdminHomePage() {
  const { t } = useTranslation()
  const [data, setData] = useState<AdminHomeData | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    function load() {
      void getAdminHome().then((next) => {
        if (cancelled) return
        setData(next)
        setError(false)
      }).catch(() => { if (!cancelled) setError(true) })
    }
    load()
    const timer = window.setInterval(load, 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [retry])

  if (!data) return <div className="admin-page">{error ? <LoadError retry={() => setRetry((n) => n + 1)} /> : <div className="spinner" aria-hidden="true" />}</div>

  const isReady = data.queues.length > 0 && data.cabinet_count > 0 && data.operator_count > 0 &&
    data.has_operator_assignment && data.paired_queue_screen_count > 0
  const waiting = data.queues.reduce((sum, queue) => sum + queue.waiting_count, 0)

  return <div className="admin-home">
    <header className="admin-home__header">
      <p className="admin-home__organization">{data.organization_name}</p>
      <h1>{t(isReady ? 'admin.home.readyTitle' : 'admin.home.welcomeTitle')}</h1>
      <p>{t(isReady ? 'admin.home.readyIntro' : 'admin.home.welcomeIntro')}</p>
    </header>
    {error && <div className="admin-home__refresh-error" role="alert">
      {t('admin.home.refreshError')} <button type="button" onClick={() => setRetry((n) => n + 1)}>{t('admin.home.retry')}</button>
    </div>}

    {!isReady ? <div className="admin-home__grid">
      <SetupList data={data} />
      <aside className="admin-home__explainer">
        <h2>{t('admin.home.howTitle')}</h2>
        <p>{t('admin.home.howIntro')}</p>
        <ol>
          <li>{t('admin.home.how.qr')}</li>
          <li>{t('admin.home.how.ticket')}</li>
          <li>{t('admin.home.how.call')}</li>
        </ol>
      </aside>
    </div> : <>
      <section className="admin-home__operations" aria-labelledby="admin-home-today">
        <div className="admin-home__section-heading">
          <h2 id="admin-home-today">{t('admin.home.today')}</h2>
          <div className="admin-home__section-links"><Link to="/admin/problems">{t('admin.nav.problems')}</Link><Link to="/admin/daily-report">{t('admin.nav.dailyReport')}</Link></div>
        </div>
        <div className="admin-home__overview">
          <div><strong>{waiting}</strong><span>{t('admin.home.waiting')}</span></div>
          <div><strong>{data.queues.length}</strong><span>{t('admin.home.activeQueues')}</span></div>
          <div><strong>{data.online_screen_count} / {data.paired_screen_count}</strong><span>{t('admin.home.screensOnline')}</span></div>
        </div>
        {data.offline_screen_count > 0 && <p className="admin-home__alert" role="status">
          {t('admin.home.screensOffline', { count: data.offline_screen_count })} <Link to="/admin/tv-screens">{t('admin.home.checkScreens')}</Link>
        </p>}
        <div className="admin-home__section-heading">
          <h3>{t('admin.home.queuesNow')}</h3>
          <Link to="/admin/queues">{t('admin.home.manageQueues')}</Link>
        </div>
        <ul className="admin-home__queue-list">
          {data.queues.map((queue) => <li key={queue.id}>
            <span>{queue.name}</span>
            <span>{t(`admin.queues.status.${queue.status}`)}</span>
            <strong>{t('admin.home.queueWaiting', { count: queue.waiting_count })}</strong>
          </li>)}
        </ul>
      </section>
      <details className="admin-home__completed-setup">
        <summary>{t('admin.home.reviewSetup')}</summary>
        <SetupList data={data} />
      </details>
    </>}
  </div>
}
