import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { TvScheduleEntry } from '../../api/types'
import {
  createDepartment, createScheduleItem, createYoutubeMedia, deleteDepartment, deleteMedia, deleteScheduleItem,
  getMediaLimits, importScheduleFile, listDepartments, listMedia, listSchedule, updateDepartment,
  updateMedia, updateScheduleItem, uploadMediaFile,
} from '../../api/signage'
import type { Department, MediaAsset, MediaLimits, ScheduleInput } from '../../api/signage'
import LoadError from '../../components/LoadError'
import ToastStack from '../../components/ToastStack'
import { useToasts } from '../../hooks/useToasts'
import { apiErrorMessage } from '../../lib/apiError'
import { groupDoctorSchedule } from '../../lib/doctorSchedule'

const EMPTY_SCHEDULE: ScheduleInput = {
  doctor_name: '', service_name: null, room: null, weekday: 0,
  starts_at: '09:00', ends_at: '17:00', sort_order: 0,
}

export default function AdminSignagePage({ organizationId }: { organizationId?: string }) {
  const { t } = useTranslation()
  const { toasts, push, dismiss } = useToasts()
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [limits, setLimits] = useState<MediaLimits | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [schedule, setSchedule] = useState<TvScheduleEntry[]>([])
  const scheduleRows = useMemo(() => groupDoctorSchedule(schedule), [schedule])
  const [departmentName, setDepartmentName] = useState('')
  const [editingDepartment, setEditingDepartment] = useState<string | null>(null)
  const [scheduleForm, setScheduleForm] = useState<ScheduleInput>(EMPTY_SCHEDULE)
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [mediaTitle, setMediaTitle] = useState('')
  const [youtubeTitle, setYoutubeTitle] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState(false)

  async function load() {
    setLoadError(false)
    try {
      const [departmentList, mediaList, mediaLimits] = await Promise.all([
        listDepartments(organizationId), listMedia(organizationId), getMediaLimits(organizationId),
      ])
      setDepartments(departmentList)
      setMedia(mediaList)
      setLimits(mediaLimits)
      setSelected((current) => current && departmentList.some((item) => item.id === current) ? current : departmentList[0]?.id ?? null)
    } catch { setLoadError(true) }
  }
  useEffect(() => { void load() }, [organizationId])
  useEffect(() => {
    if (!selected) { setSchedule([]); return }
    listSchedule(selected, organizationId).then(setSchedule).catch(() => setLoadError(true))
  }, [selected, organizationId])

  async function refreshSchedule(departmentId: string) {
    setSchedule(await listSchedule(departmentId, organizationId))
  }

  async function importSchedule(event: FormEvent) {
    event.preventDefault()
    if (!importFile) return
    if (importFile.size > 2 * 1024 * 1024) { push(t('signage.excelTooLarge')); return }
    if (!window.confirm(t('signage.importConfirm'))) return
    setBusy(true)
    try {
      const result = await importScheduleFile(importFile, organizationId)
      push(t('signage.importSuccess', { departments: result.departments, rows: result.schedule_items }))
      setImportFile(null)
      if (importInput.current) importInput.current.value = ''
      await load()
      if (selected) await refreshSchedule(selected)
    } catch (error) { push(apiErrorMessage(error, t)) }
    finally { setBusy(false) }
  }

  async function saveDepartment(event: FormEvent) {
    event.preventDefault()
    if (!departmentName.trim()) return
    setBusy(true)
    try {
      const result = editingDepartment
        ? await updateDepartment(editingDepartment, { name: departmentName.trim() }, organizationId)
        : await createDepartment({ name: departmentName.trim() }, organizationId)
      setDepartmentName('')
      setEditingDepartment(null)
      setSelected(result.id)
      await load()
    } catch (error) { push(apiErrorMessage(error, t)) }
    finally { setBusy(false) }
  }

  async function removeDepartment(department: Department) {
    if (!window.confirm(t('signage.deleteDepartmentConfirm', { name: department.name }))) return
    try { await deleteDepartment(department.id, organizationId); await load() }
    catch (error) { push(apiErrorMessage(error, t)) }
  }

  async function toggleDepartment(department: Department) {
    try { await updateDepartment(department.id, { is_active: !department.is_active }, organizationId); await load() }
    catch (error) { push(apiErrorMessage(error, t)) }
  }

  async function saveSchedule(event: FormEvent) {
    event.preventDefault()
    if (!selected || !scheduleForm.doctor_name.trim()) return
    setBusy(true)
    try {
      const body = {
        ...scheduleForm, doctor_name: scheduleForm.doctor_name.trim(),
        service_name: scheduleForm.service_name?.trim() || null,
        room: scheduleForm.room?.trim() || null,
      }
      if (editingSchedule) await updateScheduleItem(selected, editingSchedule, body, organizationId)
      else await createScheduleItem(selected, body, organizationId)
      setScheduleForm(EMPTY_SCHEDULE)
      setEditingSchedule(null)
      await refreshSchedule(selected)
    } catch (error) { push(apiErrorMessage(error, t)) }
    finally { setBusy(false) }
  }

  async function removeSchedule(item: TvScheduleEntry) {
    if (!selected || !window.confirm(t('signage.deleteScheduleConfirm'))) return
    try { await deleteScheduleItem(selected, item.id, organizationId); await refreshSchedule(selected) }
    catch (error) { push(apiErrorMessage(error, t)) }
  }

  function editScheduleItem(item: TvScheduleEntry) {
    setEditingSchedule(item.id)
    setScheduleForm({ doctor_name: item.doctor_name, service_name: item.service_name,
      room: item.room, weekday: item.weekday, starts_at: item.starts_at.slice(0, 5),
      ends_at: item.ends_at.slice(0, 5), sort_order: item.sort_order })
  }

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (!file || !mediaTitle.trim() || !limits) return
    if (file.size > limits.max_image_bytes) { push(t('signage.fileTooLarge')); return }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { push(t('signage.badImageFormat')); return }
    setBusy(true)
    setProgress(0)
    try {
      await uploadMediaFile(file, mediaTitle.trim(), 'advertisement', limits, setProgress, organizationId)
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setMediaTitle('')
      setProgress(null)
      await load()
    } catch (error) { push(apiErrorMessage(error, t)) }
    finally { setBusy(false); setProgress(null) }
  }

  async function addYoutube(event: FormEvent) {
    event.preventDefault()
    if (!youtubeTitle.trim() || !youtubeUrl.trim()) return
    setBusy(true)
    try {
      await createYoutubeMedia({ title: youtubeTitle.trim(), url: youtubeUrl.trim() }, organizationId)
      setYoutubeTitle('')
      setYoutubeUrl('')
      await load()
    } catch (error) { push(apiErrorMessage(error, t)) }
    finally { setBusy(false) }
  }

  async function toggleMedia(item: MediaAsset) {
    try { await updateMedia(item.id, { is_active: !item.is_active }, organizationId); await load() }
    catch (error) { push(apiErrorMessage(error, t)) }
  }

  async function removeMedia(item: MediaAsset) {
    if (!window.confirm(t('signage.deleteMediaConfirm', { name: item.title }))) return
    try { await deleteMedia(item.id, organizationId); await load() }
    catch (error) { push(apiErrorMessage(error, t)) }
  }

  return <div className="admin-page signage-admin">
    <div className="admin-page__header"><h1>{t('signage.title')}</h1></div>
    <p className="admin-page__hint">{t('signage.intro')}</p>
    {loadError && <LoadError retry={() => void load()} />}
    {departments === null ? <div className="spinner" aria-hidden="true" /> : <>
      <details className="signage-admin__section signage-admin__disclosure">
        <summary>{t('signage.importTitle')}</summary>
        <p className="admin-page__hint">{t('signage.importHint')}</p>
        <a href="/templates/weekly-schedule.xlsx" download>{t('signage.downloadTemplate')}</a>
        <form className="signage-admin__upload" onSubmit={(event) => void importSchedule(event)}>
          <label>{t('signage.importFile')}<input ref={importInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} required /></label>
          <button type="submit" disabled={busy || !importFile}>{t('signage.importButton')}</button>
        </form>
      </details>
      <section className="signage-admin__section">
        <h2>{t('signage.departments')}</h2>
        <form className="signage-admin__row" onSubmit={(event) => void saveDepartment(event)}>
          <input aria-label={t('signage.departmentName')} value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} placeholder={t('signage.departmentName')} required />
          <button type="submit" disabled={busy || !departmentName.trim()}>{t(editingDepartment ? 'crud.save' : 'signage.addDepartment')}</button>
          {editingDepartment && <button type="button" className="admin-button--secondary" onClick={() => { setEditingDepartment(null); setDepartmentName('') }}>{t('signage.cancel')}</button>}
        </form>
        {departments.length === 0 ? <p className="admin-page__empty">{t('signage.noDepartments')}</p> : <div className="signage-admin__departments">
          {departments.map((department) => <div className={`signage-admin__department${selected === department.id ? ' signage-admin__department--selected' : ''}`} key={department.id}>
            <button type="button" className="signage-admin__department-name" onClick={() => { setSelected(department.id); setEditingSchedule(null); setScheduleForm(EMPTY_SCHEDULE) }}>{department.name}</button>
            {!department.is_active && <span>{t('admin.users.inactive')}</span>}
            <button type="button" onClick={() => { setEditingDepartment(department.id); setDepartmentName(department.name) }}>{t('admin.common.edit')}</button>
            <button type="button" onClick={() => void toggleDepartment(department)}>{t(department.is_active ? 'admin.users.deactivate' : 'admin.users.activate')}</button>
            <button type="button" className="admin-action--danger" onClick={() => void removeDepartment(department)}>{t('signage.delete')}</button>
          </div>)}
        </div>}
      </section>

      {selected && <section className="signage-admin__section">
        <h2>{t('signage.scheduleFor', { name: departments.find((item) => item.id === selected)?.name })}</h2>
        <form className="signage-admin__schedule-form" onSubmit={(event) => void saveSchedule(event)}>
          <label>{t('signage.weekday')}<select value={scheduleForm.weekday} onChange={(event) => setScheduleForm({ ...scheduleForm, weekday: Number(event.target.value) })}>
            {Array.from({ length: 7 }, (_, weekday) => <option value={weekday} key={weekday}>{t(`signage.weekdays.${weekday}`)}</option>)}
          </select></label>
          <label>{t('signage.doctor')}<input value={scheduleForm.doctor_name} onChange={(event) => setScheduleForm({ ...scheduleForm, doctor_name: event.target.value })} required /></label>
          <label>{t('signage.service')}<input value={scheduleForm.service_name ?? ''} onChange={(event) => setScheduleForm({ ...scheduleForm, service_name: event.target.value })} /></label>
          <label>{t('signage.room')}<input value={scheduleForm.room ?? ''} onChange={(event) => setScheduleForm({ ...scheduleForm, room: event.target.value })} /></label>
          <label>{t('signage.from')}<input type="time" value={scheduleForm.starts_at} onChange={(event) => setScheduleForm({ ...scheduleForm, starts_at: event.target.value })} required /></label>
          <label>{t('signage.to')}<input type="time" value={scheduleForm.ends_at} onChange={(event) => setScheduleForm({ ...scheduleForm, ends_at: event.target.value })} required /></label>
          <button type="submit" disabled={busy || !scheduleForm.doctor_name.trim()}>{t(editingSchedule ? 'crud.save' : 'signage.addSchedule')}</button>
          {editingSchedule && <button type="button" className="admin-button--secondary" onClick={() => { setEditingSchedule(null); setScheduleForm(EMPTY_SCHEDULE) }}>{t('signage.cancel')}</button>}
        </form>
        {scheduleRows.length === 0 ? <p className="admin-page__empty">{t('signage.noSchedule')}</p> : <div className="signage-admin__table-wrap"><table className="admin-table signage-admin__weekly-table"><thead><tr><th>{t('signage.doctor')}</th><th>{t('signage.specialty')}</th><th>{t('signage.room')}</th>{Array.from({ length: 7 }, (_, weekday) => <th key={weekday}>{t(`signage.shortWeekdays.${weekday}`)}</th>)}</tr></thead><tbody>
          {scheduleRows.map((row) => <tr key={row.key}><td>{row.doctor}</td><td>{row.service || '—'}</td><td>{row.room || '—'}</td>{row.days.map((items, weekday) => <td key={weekday}>{items.length ? items.map((item) => <div className="signage-admin__cell-actions" key={item.id}>
            <button type="button" title={t('admin.common.edit')} aria-label={`${t('admin.common.edit')}: ${row.doctor}, ${t(`signage.weekdays.${weekday}`)}`} onClick={() => editScheduleItem(item)}>{item.starts_at.slice(0, 5)}–{item.ends_at.slice(0, 5)}</button>
            <button type="button" className="admin-action--danger" title={t('signage.delete')} aria-label={`${t('signage.delete')}: ${row.doctor}, ${t(`signage.weekdays.${weekday}`)}`} onClick={() => void removeSchedule(item)}>×</button>
          </div>) : '—'}</td>)}</tr>)}
        </tbody></table></div>}
      </section>}

      <section className="signage-admin__section">
        <h2>{t('signage.media')}</h2>
        <p className="admin-page__hint">{t('signage.youtubeHint')}</p>
        <form className="signage-admin__upload" onSubmit={(event) => void addYoutube(event)}>
          <label>{t('signage.mediaTitle')}<input value={youtubeTitle} onChange={(event) => setYoutubeTitle(event.target.value)} required /></label>
          <label>{t('signage.youtubeUrl')}<input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/playlist?list=..." required /></label>
          <button type="submit" disabled={busy || !youtubeTitle.trim() || !youtubeUrl.trim()}>{t('signage.addYoutube')}</button>
        </form>
        <p className="admin-page__hint">{t('signage.imageHint')}</p>
        <form className="signage-admin__upload" onSubmit={(event) => void upload(event)}>
          <label>{t('signage.mediaTitle')}<input value={mediaTitle} onChange={(event) => setMediaTitle(event.target.value)} required /></label>
          <label>{t('signage.file')}<input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !mediaTitle) setMediaTitle(next.name.replace(/\.[^.]+$/, '')) }} required /></label>
          <button type="submit" disabled={busy || !file || !mediaTitle.trim()}>{t('signage.upload')}</button>
        </form>
        {progress !== null && <div className="signage-admin__progress" role="status">{t('signage.uploadProgress', { percent: Math.round(progress * 100) })}<progress value={progress} max={1} /></div>}
        <p className="admin-page__hint">{t('signage.adsHint')}</p>
        {media.length === 0 ? <p className="admin-page__empty">{t('signage.noMedia')}</p> : <div className="signage-admin__table-wrap"><table className="admin-table"><thead><tr><th>{t('signage.mediaTitle')}</th><th>{t('signage.mediaKind')}</th><th>{t('signage.size')}</th><th>{t('directory.status')}</th><th /></tr></thead><tbody>
          {media.map((item) => {
            const youtubeLink = item.youtube_id ? item.kind === 'youtube_playlist'
              ? `https://www.youtube.com/playlist?list=${item.youtube_id}`
              : `https://www.youtube.com/watch?v=${item.youtube_id}` : null
            return <tr key={item.id}><td>{item.is_ready ? <a href={youtubeLink ?? `/api/tv/media/${item.id}`} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</td><td>{t(item.kind === 'video' || item.mime_type.startsWith('video/') ? 'signage.kindLegacy' : item.kind === 'youtube_video' ? 'signage.kindYoutubeVideo' : item.kind === 'youtube_playlist' ? 'signage.kindYoutubePlaylist' : 'signage.kindAd')}</td><td>{item.youtube_id ? '—' : t('signage.sizeMb', { size: (item.size_bytes / 1024 / 1024).toFixed(1) })}</td><td>{item.kind === 'video' || item.mime_type.startsWith('video/') ? t('signage.legacyInactive') : !item.is_ready ? t('signage.uploadIncomplete') : item.is_active ? t('admin.users.active') : t('admin.users.inactive')}</td><td className="admin-table__actions">{item.kind !== 'video' && !item.mime_type.startsWith('video/') && <button type="button" disabled={!item.is_ready} onClick={() => void toggleMedia(item)}>{t(item.is_active ? 'admin.users.deactivate' : 'admin.users.activate')}</button>}<button type="button" className="admin-action--danger" onClick={() => void removeMedia(item)}>{t('signage.delete')}</button></td></tr>
          })}
        </tbody></table></div>}
      </section>
    </>}
    <ToastStack toasts={toasts} onDismiss={dismiss} />
  </div>
}
