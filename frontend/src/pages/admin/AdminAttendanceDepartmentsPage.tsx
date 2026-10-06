import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { attendanceApi, type AttendanceDepartment } from '../../api/attendance'
import { ApiError } from '../../api/client'
import './attendance.css'

export default function AdminAttendanceDepartmentsPage() {
  const { t } = useTranslation()
  const [departments, setDepartments] = useState<AttendanceDepartment[]>([])
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [showArchive, setShowArchive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    setLoading(true)
    attendanceApi.departments().then(items => {
      if (current) { setDepartments(items); setLoaded(true); setError('') }
    }).catch(() => { if (current) setError(t('attendanceDirectory.error')) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [t])

  async function reload() {
    setLoading(true); setError('')
    try { setDepartments(await attendanceApi.departments()); setLoaded(true) }
    catch { setError(t('attendanceDirectory.error')) }
    finally { setLoading(false) }
  }

  async function perform(action: () => Promise<unknown>, message: string, after?: () => void) {
    setBusy(true); setError(''); setNotice('')
    try {
      await action(); after?.()
      setNotice(t(`attendanceDirectory.${message}`))
      setDepartments(await attendanceApi.departments())
    } catch (cause) {
      const key = cause instanceof ApiError && cause.code === 'attendance_department_exists' ? 'exists'
        : cause instanceof ApiError && cause.code === 'attendance_department_has_employees' ? 'hasEmployees' : 'error'
      setError(t(`attendanceDirectory.${key}`))
    } finally { setBusy(false) }
  }

  return <div className="admin-page attendance-admin">
    <header className="admin-page__header"><div><h1>{t('attendanceDirectory.title')}</h1><p>{t('attendanceDirectory.subtitle')}</p></div></header>
    {error && <div className="attendance-error" role="alert"><p>{error}</p><button type="button" disabled={busy || loading} onClick={() => void reload()}>{t('attendanceDirectory.retry')}</button></div>}
    {notice && <p role="status">{notice}</p>}
    <section className="attendance-admin__section" id="attendance-departments">
      <form className="attendance-department-form" onSubmit={event => {
        event.preventDefault()
        void perform(() => attendanceApi.createDepartment(name.trim()), 'created', () => setName(''))
      }}>
        <label>{t('attendanceDirectory.name')}<input required maxLength={200} value={name} disabled={busy || loading || !loaded} onChange={event => setName(event.target.value)} /></label>
        <button disabled={busy || loading || !loaded || !name.trim()}>{t('attendanceDirectory.create')}</button>
      </form>
      <label className="attendance-directory-toggle"><input type="checkbox" checked={showArchive} onChange={event => setShowArchive(event.target.checked)} />{t('attendanceDirectory.showArchive')}</label>
      {loading && <p role="status">{t('attendanceDirectory.loading')}</p>}
      {!loading && loaded && departments.filter(item => showArchive || item.is_active).length === 0 && <p className="attendance-empty">{t('attendanceDirectory.empty')}</p>}
      {departments.filter(item => showArchive || item.is_active).map(item => <div className="attendance-person attendance-department" key={item.id}>
        {editing === item.id ? <form className="attendance-department-form" onSubmit={event => {
          event.preventDefault()
          void perform(() => attendanceApi.renameDepartment(item.id, editName.trim()), 'saved', () => setEditing(null))
        }}>
          <label>{t('attendanceDirectory.name')}<input autoFocus required maxLength={200} value={editName} disabled={busy} onChange={event => setEditName(event.target.value)} /></label>
          <div className="attendance-person__actions"><button type="button" disabled={busy} onClick={() => setEditing(null)}>{t('attendanceDirectory.cancel')}</button><button disabled={busy || !editName.trim()}>{t('attendanceDirectory.save')}</button></div>
        </form> : <>
          <div><strong>{item.name}</strong><small>{t(`attendanceDirectory.${item.is_active ? 'active' : 'archived'}`)}</small></div>
          <div className="attendance-person__actions">
            <button type="button" disabled={busy || loading} aria-label={`${t('attendanceDirectory.rename')}: ${item.name}`} onClick={() => { setEditing(item.id); setEditName(item.name) }}>{t('attendanceDirectory.rename')}</button>
            <button type="button" disabled={busy || loading} aria-label={`${t(`attendanceDirectory.${item.is_active ? 'archive' : 'restore'}`)}: ${item.name}`} onClick={() => {
              if (item.is_active) {
                if (window.confirm(t('attendanceDirectory.confirmArchive', { name: item.name }))) void perform(() => attendanceApi.archiveDepartment(item.id), 'archiveDone')
              } else void perform(() => attendanceApi.restoreDepartment(item.id), 'restoreDone')
            }}>{t(`attendanceDirectory.${item.is_active ? 'archive' : 'restore'}`)}</button>
          </div>
        </>}
      </div>)}
    </section>
  </div>
}
