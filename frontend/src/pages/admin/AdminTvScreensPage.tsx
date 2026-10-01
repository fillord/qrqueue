import LoadError from '../../components/LoadError'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { createTvScreen, updateTvScreen, deleteTvScreen, getAdminCabinets, getAdminQueues, getTvScreens, unpairTvScreen } from '../../api/admin'
import type { AdminQueue, Cabinet, TvScreen } from '../../api/types'
import { listDepartments, listMedia } from '../../api/signage'
import type { Department, MediaAsset } from '../../api/signage'
import { tvConnectionStatus } from '../../lib/tvConnection'

/**
 * /admin/tv-screens (org_admin, own org) and, embedded with an explicit
 * `organizationId`, the tv-screens section of /sa/organizations/:id
 * (superadmin, any org) — same backend routes, `?organization_id=` is all
 * that differs (see api/admin.ts), so one component covers both contexts
 * instead of duplicating this CRUD UI.
 */
export default function AdminTvScreensPage({ organizationId }: { organizationId?: string }) {
  const { t, i18n } = useTranslation()
  const [loadError, setLoadError] = useState(false)
  const [screens, setScreens] = useState<TvScreen[] | null>(null)
  const [queues, setQueues] = useState<AdminQueue[]>([])
  const [cabinets, setCabinets] = useState<Cabinet[]>([])
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [language, setLanguage] = useState<TvScreen['language']>('ru')
  const [displayMode, setDisplayMode] = useState<TvScreen['display_mode']>('queue')
  const [name, setName] = useState('')
  const [queueId, setQueueId] = useState('')
  const [createQueueIds, setCreateQueueIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [expandedScreenId, setExpandedScreenId] = useState<string | null>(null)
  const [previewScreenId, setPreviewScreenId] = useState<string | null>(null)

  async function load() {
    setLoadError(false)
    try {
    const [screenList, queueList, cabinetList, mediaList, departmentList] = await Promise.all([
      getTvScreens(organizationId),
      getAdminQueues(organizationId),
      getAdminCabinets(organizationId),
      listMedia(organizationId),
      listDepartments(organizationId),
    ])
    setScreens(screenList)
    setQueues(queueList)
    setCabinets(cabinetList)
    setMedia(mediaList)
    setDepartments(departmentList)
    } catch { setLoadError(true) }
  }

  useEffect(() => {
    void load()
  }, [organizationId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
      void getTvScreens(organizationId).then((data) => {
        setScreens(data)
        setLoadError(false)
      }).catch(() => setLoadError(true))
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [organizationId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || (displayMode === 'queue' && !queueId && createQueueIds.length === 0)) return
    setSubmitting(true)
    setError(false)
    try {
      await createTvScreen({
        name: name.trim(), queue_id: displayMode === 'queue' ? queueId || null : null,
        language, display_mode: displayMode,
        ...(displayMode === 'queue' && !queueId ? { queue_selection_mode: 'selected' as const, selected_queue_ids: createQueueIds } : {}),
      }, organizationId)
      setName('')
      setQueueId('')
      setCreateQueueIds([])
      await load()
    } catch {
      setError(true)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    const screen = screens?.find((item) => item.id === id)
    if (!screen || !window.confirm(t('adminTv.deleteConfirm', { name: screen.name }))) return
    try { await deleteTvScreen(id, organizationId); await load() }
    catch { setError(true) }
  }

  async function handleUnpair(screen: TvScreen) {
    if (!window.confirm(t('adminTv.unpairConfirm', { name: screen.name }))) return
    setSubmitting(true)
    setError(false)
    try { await unpairTvScreen(screen.id, organizationId); await load() }
    catch { setError(true) }
    finally { setSubmitting(false) }
  }

  async function changeLanguage(screen: TvScreen, language: TvScreen['language']) {
    setSubmitting(true)
    try { await updateTvScreen(screen.id, { language }, organizationId); await load() }
    catch { setError(true) }
    finally { setSubmitting(false) }
  }

  async function changeScreen(screen: TvScreen, payload: Partial<Pick<TvScreen, 'name' | 'display_mode' | 'slide_seconds' | 'ads_enabled' | 'media_playlist_mode' | 'selected_media_ids' | 'queue_id' | 'queue_selection_mode' | 'selected_queue_ids' | 'cabinet_selection_mode' | 'selected_cabinet_ids' | 'department_selection_mode' | 'selected_department_ids'>>) {
    setSubmitting(true)
    try { await updateTvScreen(screen.id, payload, organizationId); await load() }
    catch { setError(true) }
    finally { setSubmitting(false) }
  }

  function visibleCabinets(screen: TvScreen) {
    return cabinets.filter((cabinet) => cabinet.is_active && !cabinet.deleted_at && (
      screen.queue_id ? cabinet.queue_id === screen.queue_id
        : screen.queue_selection_mode === 'all' || (cabinet.queue_id !== null && screen.selected_queue_ids.includes(cabinet.queue_id))
    ))
  }

  return (
    <div className="admin-tv-screens">
      <h1>{t('adminTv.title')}</h1>

      <form className="admin-tv-screens__form" data-assistant-tour="create-screen" onSubmit={(e) => void handleSubmit(e)}>
        <input
          type="text"
          placeholder={t('adminTv.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select aria-label={t('signage.screenMode')} value={displayMode} onChange={(e) => setDisplayMode(e.target.value as TvScreen['display_mode'])}>
          <option value="queue">{t('signage.modeQueue')}</option><option value="schedule">{t('signage.modeSchedule')}</option><option value="media">{t('signage.modeMedia')}</option>
        </select>
        <select aria-label={t('adminTv.columns.queue')} value={queueId} disabled={displayMode !== 'queue'} onChange={(e) => setQueueId(e.target.value)}>
          <option value="">{t('adminTv.multiQueue')}</option>
          {queues.filter((queue) => queue.is_active && !queue.deleted_at).map((queue) => (
            <option key={queue.id} value={queue.id}>
              {queue.name}
            </option>
          ))}
        </select>
        <select aria-label={t('adminTv.language')} value={language} onChange={(e) => setLanguage(e.target.value as TvScreen['language'])}><option value="kk">Қазақша</option><option value="ru">Русский</option><option value="en">English</option></select>
        {displayMode === 'queue' && !queueId && <fieldset className="admin-tv-screens__create-queues">
          <legend>{t('adminTv.queueBoard.createQueuesTitle')}</legend>
          <div className="admin-tv-screens__create-queue-list">
            {queues.filter((queue) => queue.is_active && !queue.deleted_at).map((queue) => <label key={queue.id}>
              <input type="checkbox" checked={createQueueIds.includes(queue.id)} disabled={submitting} onChange={() => setCreateQueueIds((current) => current.includes(queue.id) ? current.filter((id) => id !== queue.id) : [...current, queue.id])} />
              {queue.name}
            </label>)}
          </div>
          <small>{t('adminTv.queueBoard.createQueuesHint')}</small>
        </fieldset>}
        <button type="submit" disabled={submitting || !name.trim() || (displayMode === 'queue' && !queueId && createQueueIds.length === 0)}>
          {t('adminTv.create')}
        </button>
      </form>

      {loadError && <LoadError retry={() => void load()} />}
      {error && <p className="admin-tv-screens__error">{t('adminTv.error')}</p>}
      {screens && screens.some((screen) => tvConnectionStatus(screen, now) === 'offline') &&
        <p className="admin-tv-screens__warning" role="status">
          {t('adminTv.connection.offlineCount', { count: screens.filter((screen) => tvConnectionStatus(screen, now) === 'offline').length })}
        </p>}

      {screens === null ? (
        loadError ? null : <div className="spinner" aria-hidden="true" />
      ) : screens.length === 0 ? (
        <p>{t('adminTv.empty')}</p>
      ) : (
        <div className="admin-tv-screens__list" data-assistant-tour="screen-list">
          {screens.map((screen) => (
            <article key={screen.id} className="admin-tv-screens__card">
              <header className="admin-tv-screens__card-header">
                <div className="admin-tv-screens__identity">
                  <div className="admin-tv-screens__title-row">
                    <h2>{screen.name}</h2>
                    <span className={`admin-tv-screens__status admin-tv-screens__status--${tvConnectionStatus(screen, now)}`}>
                      {t(`adminTv.connection.${tvConnectionStatus(screen, now)}`)}
                    </span>
                  </div>
                  {screen.last_seen_at && Number.isFinite(Date.parse(screen.last_seen_at)) && <small>
                    {t('adminTv.connection.lastSeen', { time: new Date(screen.last_seen_at).toLocaleString(i18n.language) })}
                  </small>}
                </div>
                <div className="admin-tv-screens__card-actions">
                  <button type="button" aria-expanded={expandedScreenId === screen.id} aria-controls={`screen-settings-${screen.id}`}
                    onClick={() => setExpandedScreenId((current) => current === screen.id ? null : screen.id)}>
                    {t(expandedScreenId === screen.id ? 'adminTv.hideSettings' : 'adminTv.showSettings')}
                  </button>
                  {!screen.pairing_code && <button type="button" disabled={submitting} onClick={() => void handleUnpair(screen)}>{t('adminTv.unpair')}</button>}
                  <button type="button" className="admin-tv-screens__delete" disabled={submitting} onClick={() => void handleDelete(screen.id)}>{t('adminTv.delete')}</button>
                </div>
              </header>

              <div className="admin-tv-screens__summary">
                <div><span>{t('signage.screenMode')}</span><strong>{t(`signage.mode${screen.display_mode[0].toUpperCase()}${screen.display_mode.slice(1)}`)}</strong></div>
                {screen.display_mode === 'queue' && <div><span>{t('adminTv.columns.queue')}</span><strong>{screen.queue_id ? queues.find((queue) => queue.id === screen.queue_id)?.name ?? '—' : t('adminTv.multiQueue')}</strong></div>}
                {screen.pairing_code && <div className="admin-tv-screens__pairing"><span>{t('adminTv.columns.pairingCode')}</span><code className="admin-tv-screens__code">{screen.pairing_code}</code><small>{t('adminTv.pairingHelp')}</small></div>}
              </div>

              {expandedScreenId === screen.id && <div id={`screen-settings-${screen.id}`} className="admin-tv-screens__settings">
                <h3>{t('adminTv.settingsHint')}</h3>
                <div className="admin-tv-screens__preview-control">
                  <button type="button" aria-expanded={previewScreenId === screen.id} onClick={() => setPreviewScreenId((current) => current === screen.id ? null : screen.id)}>
                    {t(previewScreenId === screen.id ? 'adminTv.preview.hide' : 'adminTv.preview.show')}
                  </button>
                  {previewScreenId === screen.id && <div className="admin-tv-screens__preview-frame">
                    <iframe title={t('adminTv.preview.title', { name: screen.name })} src={`/tv/preview/${screen.id}${organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : ''}`} />
                  </div>}
                </div>
                <div className="admin-tv-screens__fields">
                  <label>{t('adminTv.nameLabel')}<input type="text" defaultValue={screen.name} key={`${screen.id}-${screen.name}`} maxLength={200} disabled={submitting} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={(e) => { const value = e.currentTarget.value.trim(); if (!value) { e.currentTarget.value = screen.name; return } if (value !== screen.name) void changeScreen(screen, { name: value }) }} /></label>
                  <label>{t('signage.screenMode')}<select value={screen.display_mode} disabled={submitting} onChange={(e) => void changeScreen(screen, { display_mode: e.target.value as TvScreen['display_mode'] })}><option value="queue">{t('signage.modeQueue')}</option><option value="schedule">{t('signage.modeSchedule')}</option><option value="media">{t('signage.modeMedia')}</option></select></label>
                  <label>{t('adminTv.language')}<select value={screen.language} disabled={submitting} onChange={(e) => void changeLanguage(screen, e.target.value as TvScreen['language'])}><option value="kk">Қазақша</option><option value="ru">Русский</option><option value="en">English</option></select></label>
                  {screen.display_mode === 'queue' && <label>{t('adminTv.queueBoard.screenSource')}<select value={screen.queue_id ?? ''} disabled={submitting} onChange={(e) => void changeScreen(screen, { queue_id: e.target.value || null })}><option value="">{t('adminTv.multiQueue')}</option>{queues.map((queue) => <option key={queue.id} value={queue.id}>{queue.name}</option>)}</select></label>}
                  {screen.display_mode === 'schedule' && <label>{t('signage.slideSeconds')}<input type="number" min="5" max="120" defaultValue={screen.slide_seconds} key={`${screen.id}-${screen.slide_seconds}`} disabled={submitting} onBlur={(e) => { const value = Number(e.target.value); if (value >= 5 && value <= 120 && value !== screen.slide_seconds) void changeScreen(screen, { slide_seconds: value }) }} /></label>}
                  {screen.display_mode === 'media' && <label className="admin-tv-screens__toggle"><input type="checkbox" checked={screen.ads_enabled} disabled={submitting} onChange={(e) => void changeScreen(screen, { ads_enabled: e.target.checked })} />{t('signage.showAds')}</label>}
                </div>
                {screen.display_mode === 'queue' && <div className="admin-tv-screens__board-options">
                  {screen.queue_id === null && <fieldset className="admin-tv-screens__playlist">
                    <legend>{t('adminTv.queueBoard.queuesTitle')}</legend>
                    <label><input type="radio" name={`queues-${screen.id}`} checked={screen.queue_selection_mode === 'all'} disabled={submitting} onChange={() => void changeScreen(screen, { queue_selection_mode: 'all' })} />{t('adminTv.queueBoard.allQueues')}</label>
                    <label><input type="radio" name={`queues-${screen.id}`} checked={screen.queue_selection_mode === 'selected'} disabled={submitting} onChange={() => void changeScreen(screen, { queue_selection_mode: 'selected' })} />{t('adminTv.queueBoard.selectedQueues')}</label>
                    {screen.queue_selection_mode === 'selected' && <div className="admin-tv-screens__media-options">
                      {queues.filter((queue) => queue.is_active && !queue.deleted_at).length === 0 ? <p>{t('adminTv.queueBoard.noQueues')}</p> : queues.filter((queue) => queue.is_active && !queue.deleted_at).map((queue) => <label key={queue.id}><input type="checkbox" checked={screen.selected_queue_ids.includes(queue.id)} disabled={submitting} onChange={() => void changeScreen(screen, { selected_queue_ids: screen.selected_queue_ids.includes(queue.id) ? screen.selected_queue_ids.filter((id) => id !== queue.id) : [...screen.selected_queue_ids, queue.id] })} />{queue.name}</label>)}
                      <small>{t('adminTv.queueBoard.queueHint')}</small>
                    </div>}
                  </fieldset>}
                  <fieldset className="admin-tv-screens__playlist">
                    <legend>{t('adminTv.queueBoard.cabinetsTitle')}</legend>
                    <label><input type="radio" name={`cabinets-${screen.id}`} checked={screen.cabinet_selection_mode === 'all'} disabled={submitting} onChange={() => void changeScreen(screen, { cabinet_selection_mode: 'all' })} />{t('adminTv.queueBoard.allCabinets')}</label>
                    <label><input type="radio" name={`cabinets-${screen.id}`} checked={screen.cabinet_selection_mode === 'selected'} disabled={submitting} onChange={() => void changeScreen(screen, { cabinet_selection_mode: 'selected' })} />{t('adminTv.queueBoard.selectedCabinets')}</label>
                    {screen.cabinet_selection_mode === 'selected' && <div className="admin-tv-screens__media-options">
                      {visibleCabinets(screen).length === 0 ? <p>{t('adminTv.queueBoard.noCabinets')}</p> : visibleCabinets(screen).map((cabinet) => <label key={cabinet.id}><input type="checkbox" checked={screen.selected_cabinet_ids.includes(cabinet.id)} disabled={submitting} onChange={() => void changeScreen(screen, { selected_cabinet_ids: screen.selected_cabinet_ids.includes(cabinet.id) ? screen.selected_cabinet_ids.filter((id) => id !== cabinet.id) : [...screen.selected_cabinet_ids, cabinet.id] })} />{cabinet.label}{cabinet.queue_id ? ` · ${queues.find((queue) => queue.id === cabinet.queue_id)?.name ?? ''}` : ''}</label>)}
                      <small>{t('adminTv.queueBoard.cabinetHint')}</small>
                    </div>}
                  </fieldset>
                </div>}
                {screen.display_mode === 'schedule' && <fieldset className="admin-tv-screens__playlist">
                  <legend>{t('adminTv.scheduleDepartments.title')}</legend>
                  <label><input type="radio" name={`departments-${screen.id}`} checked={screen.department_selection_mode === 'all'} disabled={submitting} onChange={() => void changeScreen(screen, { department_selection_mode: 'all' })} />{t('adminTv.scheduleDepartments.all')}</label>
                  <label><input type="radio" name={`departments-${screen.id}`} checked={screen.department_selection_mode === 'selected'} disabled={submitting} onChange={() => void changeScreen(screen, { department_selection_mode: 'selected', selected_department_ids: screen.selected_department_ids.length ? screen.selected_department_ids : departments.filter((department) => department.is_active).map((department) => department.id) })} />{t('adminTv.scheduleDepartments.selected')}</label>
                  {screen.department_selection_mode === 'selected' && <div className="admin-tv-screens__media-options">
                    {departments.filter((department) => department.is_active).length === 0 ? <p>{t('adminTv.scheduleDepartments.empty')}</p> : departments.filter((department) => department.is_active).map((department) => (
                      <label key={department.id}><input type="checkbox" checked={screen.selected_department_ids.includes(department.id)} disabled={submitting} onChange={() => void changeScreen(screen, { selected_department_ids: screen.selected_department_ids.includes(department.id) ? screen.selected_department_ids.filter((id) => id !== department.id) : [...screen.selected_department_ids, department.id] })} />{department.name}</label>
                    ))}
                    <small>{t('adminTv.scheduleDepartments.hint')}</small>
                  </div>}
                </fieldset>}
                {screen.display_mode === 'media' && <fieldset className="admin-tv-screens__playlist">
                  <legend>{t('adminTv.playlist.title')}</legend>
                  <label><input type="radio" name={`playlist-${screen.id}`} checked={screen.media_playlist_mode === 'all'} disabled={submitting} onChange={() => void changeScreen(screen, { media_playlist_mode: 'all' })} />{t('adminTv.playlist.all')}</label>
                  <label><input type="radio" name={`playlist-${screen.id}`} checked={screen.media_playlist_mode === 'selected'} disabled={submitting} onChange={() => void changeScreen(screen, { media_playlist_mode: 'selected' })} />{t('adminTv.playlist.selected')}</label>
                  {screen.media_playlist_mode === 'selected' && <div className="admin-tv-screens__media-options">
                    {media.filter((item) => item.is_ready && item.is_active && (item.kind.startsWith('youtube_') || item.mime_type.startsWith('image/'))).length === 0 ? <p>{t('adminTv.playlist.empty')}</p> : media.filter((item) => item.is_ready && item.is_active && (item.kind.startsWith('youtube_') || item.mime_type.startsWith('image/'))).map((item) => (
                      <label key={item.id}><input type="checkbox" checked={screen.selected_media_ids.includes(item.id)} disabled={submitting} onChange={() => void changeScreen(screen, { selected_media_ids: screen.selected_media_ids.includes(item.id) ? screen.selected_media_ids.filter((id) => id !== item.id) : [...screen.selected_media_ids, item.id] })} />{item.title}</label>
                    ))}
                    <small>{t('adminTv.playlist.adsHint')}</small>
                  </div>}
                </fieldset>}
              </div>}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
