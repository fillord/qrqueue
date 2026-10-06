import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { attendanceApi, type AttendanceReport, type AttendanceReportRow, type CalendarKind, type Employee } from '../../api/attendance'
import { ApiError } from '../../api/client'
import './attendance.css'

const kinds: CalendarKind[] = ['shift', 'off', 'vacation', 'sick', 'absence']
const hours = (minutes: number) => Math.round(minutes / 60 * 100) / 100

export default function AdminWorkforcePage({ mode }: { mode: 'calendar' | 'timesheet' }) {
  const { t, i18n } = useTranslation()
  const [month, setMonth] = useState(new Date().toLocaleDateString('sv-SE').slice(0, 7))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [report, setReport] = useState<AttendanceReport | null>(null)
  const [employeeId, setEmployeeId] = useState('')
  const [filter, setFilter] = useState('')
  const [from, setFrom] = useState(`${month}-01`)
  const [to, setTo] = useState(`${month}-01`)
  const [kind, setKind] = useState<CalendarKind>('shift')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('18:00')
  const [reason, setReason] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [telegramLink, setTelegramLink] = useState<{ name: string; url: string } | null>(null)

  useEffect(() => {
    let current = true
    setLoading(true); setReport(null); setError(''); setSelected(null)
    Promise.all([attendanceApi.employees(), attendanceApi.calendar(month)]).then(([people, data]) => {
      if (!current) return
      setEmployees(people); setReport(data)
    }).catch(() => { if (current) setError(t('workforce.error')) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [month, t])

  const groups = useMemo(() => {
    const map = new Map<string, AttendanceReportRow[]>()
    for (const row of report?.rows ?? []) {
      if (filter && row.employee_id !== filter) continue
      map.set(row.employee_id, [...(map.get(row.employee_id) ?? []), row])
    }
    return [...map.values()].sort((a, b) => a[0].employee_name.localeCompare(b[0].employee_name))
  }, [report, filter])
  const days = Array.from({ length: report ? Number(report.date_to.slice(-2)) : 0 }, (_, index) => index + 1)
  const timeText = (value: string | null) => value && report ? new Intl.DateTimeFormat(i18n.language, {
    timeZone: report.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value)) : '—'

  function edit(row: AttendanceReportRow) {
    setEmployeeId(row.employee_id); setFrom(row.date); setTo(row.date)
    setKind(row.calendar_kind); setSelected(row.calendar_id)
    setStart(row.planned_start ? timeText(row.planned_start) : '09:00')
    setEnd(row.planned_end ? timeText(row.planned_end) : '18:00')
    setReason(row.reason ?? ''); setNotice('')
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    document.getElementById('workforce-editor')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  }

  async function mutate(reset = false) {
    setBusy(true); setError(''); setNotice('')
    try {
      if (reset && selected) await attendanceApi.resetCalendar(selected, reason)
      else await attendanceApi.saveCalendar({ employee_id: employeeId, date_from: from, date_to: to,
        kind, reason, ...(kind === 'shift' ? { starts_at: start, ends_at: end } : {}) })
      setReport(await attendanceApi.calendar(month)); setSelected(null); setNotice(t('workforce.saved'))
    } catch { setError(t('workforce.error')) }
    finally { setBusy(false) }
  }

  async function connect(employee: Employee) {
    setBusy(true); setError(''); setTelegramLink(null)
    try { const link = await attendanceApi.telegram(employee.id); setTelegramLink({ name: employee.full_name, url: link.url }) }
    catch (cause) { setError(t(cause instanceof ApiError && cause.code === 'telegram_not_configured' ? 'workforce.botMissing' : 'workforce.error')) }
    finally { setBusy(false) }
  }

  async function download() {
    setBusy(true); setError('')
    try {
      const language = ['ru', 'kk', 'en'].includes(i18n.language) ? i18n.language : 'ru'
      const response = await fetch(`/api/attendance/admin/timesheet.xlsx?month=${encodeURIComponent(month)}&language=${language}`, { credentials: 'include', cache: 'no-store' })
      if (!response.ok) throw new Error('export_failed')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a'); link.href = url; link.download = `timesheet-${month}.xlsx`
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setError(t('workforce.error')) }
    finally { setBusy(false) }
  }

  return <div className="admin-page attendance-admin">
    <header className="admin-page__header"><div><h1>{t(`workforce.${mode}`)}</h1><p>{t('workforce.subtitle')}</p></div></header>
    <div className="attendance-admin__filters">
      <label>{t('workforce.month')}<input type="month" min="2000-01" max="2100-12" value={month} disabled={busy} onChange={event => { if (event.target.value) setMonth(event.target.value) }} /></label>
      <label>{t('workforce.employee')}<select value={filter} onChange={event => setFilter(event.target.value)}><option value="">{t('workforce.all')}</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>
      <button disabled={busy || loading || !report} onClick={() => void download()}>{t('workforce.export')}</button>
    </div>
    {error && <p className="attendance-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">{t('workforce.loading')}</p>}
    {!loading && employees.length === 0 && <p>{t('workforce.empty')}</p>}
    {mode === 'calendar' && employees.length > 0 && <section className="attendance-admin__section" id="workforce-editor">
      <h2>{t('workforce.calendar')}</h2>
      <form className="attendance-admin__create" onSubmit={event => { event.preventDefault(); void mutate() }}>
        <label>{t('workforce.employee')}<select required value={employeeId} onChange={event => { setEmployeeId(event.target.value); setSelected(null) }}><option value="">—</option>{employees.filter(person => person.is_active).map(person => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label>
        <label>{t('workforce.from')}<input required type="date" value={from} onChange={event => { setFrom(event.target.value); setSelected(null) }} /></label>
        <label>{t('workforce.to')}<input required type="date" min={from} value={to} onChange={event => { setTo(event.target.value); setSelected(null) }} /></label>
        <label>{t('workforce.kind')}<select value={kind} onChange={event => setKind(event.target.value as CalendarKind)}>{kinds.map(value => <option key={value} value={value}>{t(`workforce.statuses.${value}`)}</option>)}</select></label>
        {kind === 'shift' && <><label>{t('workforce.start')}<input required type="time" value={start} onChange={event => setStart(event.target.value)} /></label><label>{t('workforce.end')}<input required type="time" value={end} onChange={event => setEnd(event.target.value)} /></label></>}
        <label>{t('workforce.reason')}<input required minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button disabled={busy || loading}>{t('workforce.save')}</button>
        {selected && from === to && <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void mutate(true)}>{t('workforce.reset')}</button>}
      </form>
    </section>}
    {report && <section className="attendance-admin__section">
      <p>{t('workforce.legend')} · {report.timezone}</p>
      {report.rows.some(row => row.needs_review) && <p className="attendance-admin__schedule-warning">{t('workforce.review')}</p>}
      <div className="attendance-table-scroll"><table className="attendance-table workforce-table"><thead><tr><th>{t('workforce.employee')}</th>{days.map(day => <th key={day}>{day}</th>)}{['planned', 'worked', 'late', 'overtime'].map(key => <th key={key}>{t(`workforce.${key}`)}</th>)}</tr></thead>
        <tbody>{groups.map(rows => <tr key={rows[0].employee_id}><th>{rows[0].employee_name}<small>{rows[0].department}</small></th>{days.map(day => {
          const row = rows.find(item => Number(item.date.slice(-2)) === day)
          if (!row) return <td key={day}>—</td>
          const label = row.needs_review ? '?' : mode === 'timesheet'
            ? row.worked_minutes ? String(hours(row.worked_minutes)) : t(`workforce.statuses.${row.status}`)
            : row.calendar_kind === 'shift' ? `${timeText(row.planned_start)}–${timeText(row.planned_end)}` : t(`workforce.statuses.${row.calendar_kind}`)
          const title = `${row.date}: ${t(`workforce.statuses.${row.status}`)}. ${t('workforce.worked')}: ${hours(row.worked_minutes ?? 0)}. ${row.reason ?? ''}`
          return <td key={day} className={`workforce-day workforce-day--${row.calendar_kind}`}>
            {mode === 'calendar' ? <button type="button" disabled={busy} title={title} aria-label={`${rows[0].employee_name}, ${title}`} onClick={() => edit(row)}>{label}</button> : <span title={title}>{label}</span>}
          </td>
        })}<td>{hours(rows.reduce((sum, row) => sum + row.planned_minutes, 0))}</td><td>{hours(rows.reduce((sum, row) => sum + (row.worked_minutes ?? 0), 0))}</td><td>{rows.reduce((sum, row) => sum + row.late_minutes, 0)}</td><td>{hours(rows.reduce((sum, row) => sum + row.overtime_minutes, 0))}</td></tr>)}</tbody></table></div>
    </section>}
    {mode === 'calendar' && <section className="attendance-admin__section"><h2>Telegram</h2><p>{t('workforce.stop')}</p>{employees.filter(employee => employee.is_active).map(employee => <div className="attendance-person" key={employee.id}><strong>{employee.full_name}</strong><div>{employee.telegram_connected && <span>{t('workforce.connected')} </span>}<button disabled={busy} onClick={() => void connect(employee)}>{t('workforce.telegram')}</button></div></div>)}
      {telegramLink && <div role="status"><strong>{telegramLink.name}</strong><p>{t('workforce.share')}</p><label>Telegram<input readOnly value={telegramLink.url} onFocus={event => event.target.select()} /></label></div>}
    </section>}
  </div>
}
