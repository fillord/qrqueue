import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { getAdminQueues } from '../../api/admin'
import type { AdminQueue } from '../../api/types'
import { queueKioskApi, type KioskSettings, type QueueKiosk } from '../../api/queueKiosk'
import './attendance.css'
import '../kiosk/queue-kiosk.css'

const blank: KioskSettings = { name: '', queue_ids: [], printing_enabled: false, paper_width: 80, language: 'ru' }

export default function AdminQueueKiosksPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState<QueueKiosk[]>([])
  const [queues, setQueues] = useState<AdminQueue[]>([])
  const [draft, setDraft] = useState<KioskSettings>({ ...blank })
  const [editing, setEditing] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function load() {
    setError('')
    try {
      const [kiosks, available] = await Promise.all([queueKioskApi.list(), getAdminQueues()])
      setItems(kiosks); setQueues(available.filter(q => q.is_active)); setLoaded(true)
    } catch { setError(t('queueKiosk.error')) }
  }
  useEffect(() => { void load() }, [])
  async function perform(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(t('queueKiosk.saved')); await load() }
    catch { setError(t('queueKiosk.error')) }
    finally { setBusy(false) }
  }
  return <div className="admin-page attendance-admin queue-kiosk-admin">
    <header className="admin-page__header"><div><h1>{t('queueKiosk.title')}</h1><p>{t('queueKiosk.subtitle')}</p></div><Link to="/kiosk" target="_blank" rel="noreferrer">{t('queueKiosk.open')}</Link></header>
    {error && <div role="alert" className="attendance-error">{error} <button disabled={busy} onClick={() => void load()}>{t('queueKiosk.retry')}</button></div>}
    {notice && <p role="status">{notice}</p>}
    <section className="attendance-admin__section">
      <h2>{t(`queueKiosk.${editing ? 'edit' : 'create'}`)}</h2>
      <form className="queue-kiosk-admin__form" onSubmit={event => {
        event.preventDefault()
        void perform(async () => {
          if (editing) await queueKioskApi.update(editing, draft)
          else await queueKioskApi.create(draft)
          setDraft({ ...blank }); setEditing(null)
        })
      }}>
        <label>{t('queueKiosk.name')}<input required maxLength={200} disabled={busy || !loaded} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>{t('queueKiosk.language')}<select disabled={busy} value={draft.language} onChange={e => setDraft({ ...draft, language: e.target.value as KioskSettings['language'] })}><option value="ru">Русский</option><option value="kk">Қазақша</option><option value="en">English</option></select></label>
        <fieldset><legend>{t('queueKiosk.queues')}</legend>
          {!queues.length && <p>{t('queueKiosk.noQueues')}</p>}
          {queues.map(queue => <label className="queue-kiosk-check" key={queue.id}><input type="checkbox" disabled={busy} checked={draft.queue_ids.includes(queue.id)} onChange={e => setDraft({ ...draft, queue_ids: e.target.checked ? [...draft.queue_ids, queue.id] : draft.queue_ids.filter(id => id !== queue.id) })} />{queue.name}</label>)}
        </fieldset>
        <label className="queue-kiosk-check"><input type="checkbox" disabled={busy} checked={draft.printing_enabled} onChange={e => setDraft({ ...draft, printing_enabled: e.target.checked })} />{t('queueKiosk.printing')}</label>
        {draft.printing_enabled && <><label>{t('queueKiosk.paper')}<select disabled={busy} value={draft.paper_width} onChange={e => setDraft({ ...draft, paper_width: Number(e.target.value) as 58 | 80 })}><option value={80}>80 mm</option><option value={58}>58 mm</option></select></label><p>{t('queueKiosk.printSetup')}</p></>}
        <div className="attendance-person__actions"><button disabled={busy || !loaded || !draft.name.trim() || !draft.queue_ids.length}>{t(`queueKiosk.${editing ? 'save' : 'create'}`)}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setDraft({ ...blank }) }}>{t('queueKiosk.cancel')}</button>}</div>
      </form>
    </section>
    {!loaded && !error && <p role="status">{t('queueKiosk.loading')}</p>}
    {loaded && !items.length && <p>{t('queueKiosk.empty')}</p>}
    {items.map(item => <section className="attendance-admin__section" key={item.id}>
      <h2>{item.name}</h2><p>{t(`queueKiosk.${item.paired ? 'paired' : 'unpaired'}`)}</p>
      {item.pairing_code && <p>{t('queueKiosk.code')}: <strong className="queue-kiosk-admin__code">{item.pairing_code}</strong><br /><small>{t('queueKiosk.expires', { time: new Date(item.pairing_expires_at!).toLocaleString() })}</small></p>}
      <p>{item.queue_ids.map(id => queues.find(q => q.id === id)?.name).filter(Boolean).join(', ')}</p>
      <div className="attendance-person__actions">
        <button disabled={busy} onClick={() => { setEditing(item.id); setDraft({ name: item.name, queue_ids: item.queue_ids.filter(id => queues.some(q => q.id === id)), printing_enabled: item.printing_enabled, paper_width: item.paper_width, language: item.language }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{t('queueKiosk.edit')}</button>
        <button disabled={busy} onClick={() => { if (window.confirm(t('queueKiosk.renewConfirm'))) void perform(() => queueKioskApi.unpair(item.id)) }}>{t('queueKiosk.renew')}</button>
        <button disabled={busy} onClick={() => { if (window.confirm(t('queueKiosk.archiveConfirm'))) void perform(() => queueKioskApi.archive(item.id)) }}>{t('queueKiosk.archive')}</button>
      </div>
    </section>)}
  </div>
}
