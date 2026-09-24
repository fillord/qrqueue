import LoadError from '../../components/LoadError'
import { Fragment, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { createTvScreen, updateTvScreen, deleteTvScreen, getAdminCabinets, getAdminQueues, getTvScreens } from '../../api/admin'
import type { AdminQueue, Cabinet, TvScreen } from '../../api/types'
import { listMedia } from '../../api/signage'
import type { MediaAsset } from '../../api/signage'

/**
 * /admin/tv-screens (org_admin, own org) and, embedded with an explicit
 * `organizationId`, the tv-screens section of /sa/organizations/:id
 * (superadmin, any org) — same backend routes, `?organization_id=` is all
 * that differs (see api/admin.ts), so one component covers both contexts
 * instead of duplicating this CRUD UI.
 */
export default function AdminTvScreensPage({ organizationId }: { organizationId?: string }) {
  const { t } = useTranslation()
  const [loadError, setLoadError] = useState(false)
  const [screens, setScreens] = useState<TvScreen[] | null>(null)
  const [queues, setQueues] = useState<AdminQueue[]>([])
  const [cabinets, setCabinets] = useState<Cabinet[]>([])
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [language, setLanguage] = useState<TvScreen['language']>('ru')
  const [displayMode, setDisplayMode] = useState<TvScreen['display_mode']>('queue')
  const [name, setName] = useState('')
  const [queueId, setQueueId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)

  async function load() {
    setLoadError(false)
    try {
    const [screenList, queueList, cabinetList, mediaList] = await Promise.all([
      getTvScreens(organizationId),
      getAdminQueues(organizationId),
      getAdminCabinets(organizationId),
      listMedia(organizationId),
    ])
    setScreens(screenList)
    setQueues(queueList)
    setCabinets(cabinetList)
    setMedia(mediaList)
    } catch { setLoadError(true) }
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
      await createTvScreen({ name: name.trim(), queue_id: displayMode === 'queue' ? queueId || null : null, language, display_mode: displayMode }, organizationId)
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
    try { await deleteTvScreen(id, organizationId); await load() }
    catch { setError(true) }
  }

  async function changeLanguage(screen: TvScreen, language: TvScreen['language']) {
    setSubmitting(true)
    try { await updateTvScreen(screen.id, { language }, organizationId); await load() }
    catch { setError(true) }
    finally { setSubmitting(false) }
  }

  async function changeScreen(screen: TvScreen, payload: Partial<Pick<TvScreen, 'display_mode' | 'slide_seconds' | 'ads_enabled' | 'media_playlist_mode' | 'selected_media_ids' | 'queue_id' | 'queue_selection_mode' | 'selected_queue_ids' | 'cabinet_selection_mode' | 'selected_cabinet_ids'>>) {
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

      <form className="admin-tv-screens__form" onSubmit={(e) => void handleSubmit(e)}>
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
          <option value="">{t('adminTv.noQueue')}</option>
          {queues.map((queue) => (
            <option key={queue.id} value={queue.id}>
              {queue.name}
            </option>
          ))}
        </select>
        <select aria-label={t('adminTv.language')} value={language} onChange={(e) => setLanguage(e.target.value as TvScreen['language'])}><option value="kk">Қазақша</option><option value="ru">Русский</option><option value="en">English</option></select>
        <button type="submit" disabled={submitting || !name.trim()}>
          {t('adminTv.create')}
        </button>
      </form>

      {loadError && <LoadError retry={() => void load()} />}
      {error && <p className="admin-tv-screens__error">{t('adminTv.error')}</p>}

      {screens === null ? (
        loadError ? null : <div className="spinner" aria-hidden="true" />
      ) : screens.length === 0 ? (
        <p>{t('adminTv.empty')}</p>
      ) : (
        <table className="admin-tv-screens__table">
          <thead>
            <tr>
              <th>{t('adminTv.columns.name')}</th>
              <th>{t('adminTv.columns.queue')}</th>
              <th>{t('adminTv.columns.pairingCode')}</th><th>{t('adminTv.language')}</th><th>{t('signage.screenMode')}</th><th>{t('signage.slideSeconds')}</th><th>{t('signage.showAds')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {screens.map((screen) => (
              <Fragment key={screen.id}><tr>
                <td>{screen.name}</td>
                <td>{screen.display_mode === 'queue' ? <select aria-label={t('adminTv.queueBoard.screenSource')} value={screen.queue_id ?? ''} disabled={submitting} onChange={(e) => void changeScreen(screen, { queue_id: e.target.value || null })}>
                  <option value="">{t('adminTv.noQueue')}</option>
                  {queues.map((queue) => <option key={queue.id} value={queue.id}>{queue.name}</option>)}
                </select> : (queues.find((q) => q.id === screen.queue_id)?.name ?? '—')}</td>
                <td>
                  {screen.pairing_code ? (
                    <code className="admin-tv-screens__code">{screen.pairing_code}</code>
                  ) : (
                    t('adminTv.paired')
                  )}
                </td>
                <td><select aria-label={t('adminTv.language')} value={screen.language} disabled={submitting} onChange={(e) => void changeLanguage(screen, e.target.value as TvScreen['language'])}><option value="kk">Қазақша</option><option value="ru">Русский</option><option value="en">English</option></select></td>
                <td><select aria-label={t('signage.screenMode')} value={screen.display_mode} disabled={submitting} onChange={(e) => void changeScreen(screen, { display_mode: e.target.value as TvScreen['display_mode'] })}><option value="queue">{t('signage.modeQueue')}</option><option value="schedule">{t('signage.modeSchedule')}</option><option value="media">{t('signage.modeMedia')}</option></select></td>
                <td><input aria-label={t('signage.slideSeconds')} type="number" min="5" max="120" defaultValue={screen.slide_seconds} key={`${screen.id}-${screen.slide_seconds}`} disabled={submitting || screen.display_mode === 'queue'} onBlur={(e) => { const value = Number(e.target.value); if (value >= 5 && value <= 120 && value !== screen.slide_seconds) void changeScreen(screen, { slide_seconds: value }) }} /></td>
                <td><input aria-label={t('signage.showAds')} type="checkbox" checked={screen.ads_enabled} disabled={submitting || screen.display_mode !== 'media'} onChange={(e) => void changeScreen(screen, { ads_enabled: e.target.checked })} /></td>
                <td>
                  <button type="button" onClick={() => void handleDelete(screen.id)}>
                    {t('adminTv.delete')}
                  </button>
                </td>
              </tr>
              {screen.display_mode === 'queue' && <tr className="admin-tv-screens__playlist-row"><td colSpan={8}>
                <div className="admin-tv-screens__board-options">
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
                </div>
              </td></tr>}
              {screen.display_mode === 'media' && <tr className="admin-tv-screens__playlist-row"><td colSpan={8}>
                <fieldset className="admin-tv-screens__playlist">
                  <legend>{t('adminTv.playlist.title')}</legend>
                  <label><input type="radio" name={`playlist-${screen.id}`} checked={screen.media_playlist_mode === 'all'} disabled={submitting} onChange={() => void changeScreen(screen, { media_playlist_mode: 'all' })} />{t('adminTv.playlist.all')}</label>
                  <label><input type="radio" name={`playlist-${screen.id}`} checked={screen.media_playlist_mode === 'selected'} disabled={submitting} onChange={() => void changeScreen(screen, { media_playlist_mode: 'selected' })} />{t('adminTv.playlist.selected')}</label>
                  {screen.media_playlist_mode === 'selected' && <div className="admin-tv-screens__media-options">
                    {media.filter((item) => item.is_ready && item.is_active).length === 0 ? <p>{t('adminTv.playlist.empty')}</p> : media.filter((item) => item.is_ready && item.is_active).map((item) => (
                      <label key={item.id}><input type="checkbox" checked={screen.selected_media_ids.includes(item.id)} disabled={submitting} onChange={() => void changeScreen(screen, { selected_media_ids: screen.selected_media_ids.includes(item.id) ? screen.selected_media_ids.filter((id) => id !== item.id) : [...screen.selected_media_ids, item.id] })} />{item.title}</label>
                    ))}
                    <small>{t('adminTv.playlist.adsHint')}</small>
                  </div>}
                </fieldset>
              </td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
