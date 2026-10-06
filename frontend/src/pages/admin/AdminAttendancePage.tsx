import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Link } from 'react-router-dom'
import { attendanceApi, importEmployeeFile, pendingFacePhoto } from '../../api/attendance'
import type { AttendanceDepartment, AttendanceEvent, AttendanceKiosk, AttendanceReport, AttendanceReportRow, AttendanceSettings, AttendanceStats, Employee, EmployeeImportResult, WorkScheduleDay } from '../../api/attendance'
import { useAttendanceCamera } from '../../hooks/useAttendanceCamera'
import { ApiError } from '../../api/client'
import { getAttendanceLocation } from '../../lib/attendanceLocation'
import './attendance.css'
import i18n from '../../app/i18n'

const errorText = (error: unknown) => {
  if (!(error instanceof ApiError)) return 'Не удалось выполнить действие. Попробуйте ещё раз.'
  const known: Record<string, string> = {
    face_count_invalid: 'В кадре должно быть ровно одно лицо.',
    face_too_small: 'Подойдите ближе к камере.',
    face_capture_inconsistent: 'Кадры не совпали. Повторите съёмку.',
    face_model_unavailable: 'Модель распознавания недоступна на сервере.',
    attendance_department_invalid: 'Выберите действующее отделение.',
    attendance_department_unknown: 'В Excel указано отделение, которого нет в организации.',
    employee_already_exists: 'Такой сотрудник уже есть в этом отделении.',
    invalid_excel_headers: 'Неверные заголовки Excel. Скачайте шаблон и заполните его.',
    invalid_excel_format: 'Не удалось прочитать Excel-файл.',
    invalid_employee_row: 'Проверьте имя, отделение и должность в Excel.',
    duplicate_employee_row: 'В Excel повторяется сотрудник в том же отделении.',
    excel_too_large: 'Excel-файл слишком большой.',
    face_already_registered: 'Это лицо уже зарегистрировано у другого сотрудника.',
    face_request_missing: 'Заявка уже обработана.',
    face_review_photo_missing: 'У этой заявки нет снимка. Отклоните её и попросите сотрудника отправить новую.',
    face_identity_check_required: 'Перед подтверждением лично сверьте сотрудника со снимком.',
    attendance_geo_config_incomplete: 'Укажите координаты и радиус перед включением геоограничения.',
    attendance_report_range_invalid: 'Период отчёта должен быть корректным и не длиннее 93 дней.',
  }
  const base = known[error.code] ?? 'Не удалось выполнить действие. Проверьте данные и попробуйте снова.'
  return error.row ? `${base} Строка ${error.row}.` : base
}

function localDateTime(value: string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const SHORT_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DEFAULT_SCHEDULE: WorkScheduleDay[] = [0, 1, 2, 3, 4].map((weekday) => ({ weekday, starts_at: '09:00', ends_at: '18:00' }))

function dateInputValue(date: Date) {
  return date.toLocaleDateString('sv-SE')
}

function ScheduleEditor({ value, onChange, disabled = false }: { value: WorkScheduleDay[]; onChange: (value: WorkScheduleDay[]) => void; disabled?: boolean }) {
  const byDay = new Map(value.map((item) => [item.weekday, item]))
  function update(weekday: number, patch: Partial<WorkScheduleDay>) {
    const current = byDay.get(weekday)
    if (!current) return
    onChange(value.map((item) => item.weekday === weekday ? { ...item, ...patch } : item).sort((a, b) => a.weekday - b.weekday))
  }
  function toggle(weekday: number, checked: boolean) {
    onChange((checked ? [...value, { weekday, starts_at: '09:00', ends_at: '18:00' }] : value.filter((item) => item.weekday !== weekday)).sort((a, b) => a.weekday - b.weekday))
  }
  return <div className="attendance-schedule-editor">
    {WEEKDAYS.map((label, weekday) => { const item = byDay.get(weekday); return <div className="attendance-schedule-editor__day" key={label}>
      <label className="attendance-schedule-editor__toggle"><input type="checkbox" checked={Boolean(item)} disabled={disabled} onChange={(event) => toggle(weekday, event.target.checked)} /><span>{label}</span></label>
      <label>Начало<input type="time" value={item?.starts_at ?? '09:00'} disabled={disabled || !item} required={Boolean(item)} onChange={(event) => update(weekday, { starts_at: event.target.value })} /></label>
      <label>Окончание<input type="time" value={item?.ends_at ?? '18:00'} disabled={disabled || !item} required={Boolean(item)} min={item?.starts_at} onChange={(event) => update(weekday, { ends_at: event.target.value })} /></label>
    </div> })}
  </div>
}

function scheduleText(schedule: WorkScheduleDay[]) {
  if (!schedule.length) return 'График не задан'
  return schedule.map((item) => `${SHORT_WEEKDAYS[item.weekday]} ${item.starts_at}–${item.ends_at}`).join(' · ')
}

function durationText(minutes: number | null) {
  if (minutes === null) return '—'
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

function timeText(value: string | null, timezoneName: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', { timeZone: timezoneName, hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

const REPORT_STATUS: Record<AttendanceReportRow['status'], string> = {
  planned: 'Запланировано', in_progress: 'На работе', completed: 'По графику', late: 'Опоздание',
  early_leave: 'Ранний уход', late_early: 'Опоздание и ранний уход', absent: 'Отсутствие', incomplete: 'Нет одной отметки',
  get off() { return i18n.t('workforce.statuses.off') },
  get vacation() { return i18n.t('workforce.statuses.vacation') },
  get sick() { return i18n.t('workforce.statuses.sick') },
  get absence() { return i18n.t('workforce.statuses.absence') },
}

export default function AdminAttendancePage({ section }: { section: 'summary' | 'employees' | 'events' | 'settings' }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [events, setEvents] = useState<AttendanceEvent[]>([])
  const [day, setDay] = useState(new Date().toLocaleDateString('sv-SE'))
  const [name, setName] = useState('')
  const [departments, setDepartments] = useState<AttendanceDepartment[]>([])
  const [departmentId, setDepartmentId] = useState('')
  const [position, setPosition] = useState('')
  const [newSchedule, setNewSchedule] = useState<WorkScheduleDay[]>(DEFAULT_SCHEDULE)
  const [search, setSearch] = useState('')
  const [filterDepartment, setFilterDepartment] = useState('')
  const [stats, setStats] = useState<AttendanceStats | null>(null)
  const [report, setReport] = useState<AttendanceReport | null>(null)
  const [reportFrom, setReportFrom] = useState(() => { const date = new Date(); date.setDate(date.getDate() - 6); return dateInputValue(date) })
  const [reportTo, setReportTo] = useState(() => dateInputValue(new Date()))
  const [reportDepartment, setReportDepartment] = useState('')
  const [settings, setSettings] = useState<AttendanceSettings | null>(null)
  const [geoEnabled, setGeoEnabled] = useState(false)
  const [geoLatitude, setGeoLatitude] = useState('')
  const [geoLongitude, setGeoLongitude] = useState('')
  const [geoRadius, setGeoRadius] = useState('200')
  const [geoAccuracy, setGeoAccuracy] = useState<number | null>(null)
  const [kiosks, setKiosks] = useState<AttendanceKiosk[]>([])
  const [kioskName, setKioskName] = useState('')
  const [enrollmentQr, setEnrollmentQr] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<EmployeeImportResult | null>(null)
  const [revealedCode, setRevealedCode] = useState<{ name: string; code: string } | null>(null)
  const [enrolling, setEnrolling] = useState<Employee | null>(null)
  const [reviewing, setReviewing] = useState<Employee | null>(null)
  const [reviewImage, setReviewImage] = useState<string | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [identityChecked, setIdentityChecked] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [scheduleEmployee, setScheduleEmployee] = useState<Employee | null>(null)
  const [editSchedule, setEditSchedule] = useState<WorkScheduleDay[]>([])
  const [editName, setEditName] = useState('')
  const [editDepartment, setEditDepartment] = useState('')
  const [editPosition, setEditPosition] = useState('')
  const [consent, setConsent] = useState(false)
  const [editing, setEditing] = useState<AttendanceEvent | null>(null)
  const [editKind, setEditKind] = useState<'in' | 'out'>('in')
  const [editTime, setEditTime] = useState('')
  const [reason, setReason] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualEmployee, setManualEmployee] = useState('')
  const [manualKind, setManualKind] = useState<'in' | 'out'>('in')
  const [manualTime, setManualTime] = useState('')
  const [manualReason, setManualReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { videoRef, cameraActive, startPreview, stopPreview, capture } = useAttendanceCamera()

  useEffect(() => {
    if (!reviewing) return
    let cancelled = false
    let objectUrl: string | null = null
    setReviewImage(null)
    setReviewLoading(true)
    void pendingFacePhoto(reviewing.id).then((blob) => {
      objectUrl = URL.createObjectURL(blob)
      if (cancelled) URL.revokeObjectURL(objectUrl)
      else setReviewImage(objectUrl)
    }).catch((err) => { if (!cancelled) setError(errorText(err)) }).finally(() => { if (!cancelled) setReviewLoading(false) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [reviewing?.id])

  function closeReview() { setReviewing(null); setIdentityChecked(false); setReviewImage(null) }

  async function load() {
    const [people, marks, summary, options, currentSettings, currentKiosks, currentReport] = await Promise.all([
      attendanceApi.employees(), attendanceApi.events(day), attendanceApi.stats(), attendanceApi.departments(), attendanceApi.settings(), attendanceApi.kiosks(),
      section === 'summary' ? attendanceApi.report(reportFrom, reportTo, reportDepartment || undefined) : Promise.resolve(null),
    ])
    setEmployees(people)
    setEvents(marks)
    setStats(summary)
    setDepartments(options.filter((item) => item.is_active))
    setSettings(currentSettings)
    setGeoEnabled(currentSettings.geo_enabled)
    setGeoLatitude(currentSettings.geo_latitude?.toString() ?? '')
    setGeoLongitude(currentSettings.geo_longitude?.toString() ?? '')
    setGeoRadius(currentSettings.geo_radius_m?.toString() ?? '200')
    setKiosks(currentKiosks)
    setReport(currentReport)
  }

  useEffect(() => {
    if (!settings) return
    const url = `${window.location.origin}/attendance/enroll?token=${encodeURIComponent(settings.enrollment_token)}`
    void QRCode.toDataURL(url, { width: 240, margin: 1 }).then(setEnrollmentQr).catch(() => setEnrollmentQr(''))
  }, [settings?.enrollment_token])

  useEffect(() => { void load().catch((err) => setError(errorText(err))) }, [day, reportFrom, reportTo, reportDepartment, section])

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try { await action(); await load() }
    catch (err) { setError(errorText(err)) }
    finally { setBusy(false) }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    await perform(async () => {
      const created = await attendanceApi.createEmployee({ full_name: name.trim(), department_id: departmentId, position: position.trim() || undefined, schedule: newSchedule })
      setRevealedCode({ name: created.full_name, code: created.code })
      setName(''); setPosition(''); setNewSchedule(DEFAULT_SCHEDULE)
    })
  }

  async function importEmployees(event: React.FormEvent) {
    event.preventDefault()
    if (!importFile) return
    await perform(async () => { setImportResult(await importEmployeeFile(importFile)); setImportFile(null) })
  }

  function downloadCodes() {
    if (!importResult) return
    const lines = ['ФИО;Отделение;Личный код', ...importResult.employees.map((item) => {
      const columns = [item.full_name, item.department].map((part) => {
        const safe = /^\s*[=+\-@]/.test(part) ? `'${part}` : part
        return `"${safe.replace(/"/g, '""')}"`
      })
      // Excel otherwise turns a code such as 0001 into the number 1.
      return [...columns, `"=""${item.code}"""`].join(';')
    })]
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'attendance-codes.csv'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function downloadReport() {
    if (!report) return
    const safe = (value: string | number | null) => {
      const text = value === null ? '' : String(value)
      const protectedText = /^\s*[=+\-@]/.test(text) ? `'${text}` : text
      return `"${protectedText.replace(/"/g, '""')}"`
    }
    const rows = report.rows.map((item) => [item.date, item.employee_name, item.department, item.position,
      `${timeText(item.planned_start, report.timezone)}–${timeText(item.planned_end, report.timezone)}`,
      timeText(item.first_in, report.timezone), timeText(item.last_out, report.timezone), durationText(item.worked_minutes),
      item.late_minutes, item.early_leave_minutes, item.overtime_minutes, REPORT_STATUS[item.status]])
    const lines = [['Дата', 'Сотрудник', 'Отделение', 'Должность', 'План', 'Приход', 'Уход', 'Отработано', 'Опоздание, мин', 'Ранний уход, мин', 'Переработка, мин', 'Статус'], ...rows]
      .map((row) => row.map(safe).join(';'))
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `attendance-${report.date_from}-${report.date_to}.csv`; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const visibleEmployees = employees.filter((person) =>
    (!filterDepartment || person.department_id === filterDepartment) &&
    (!search.trim() || `${person.full_name} ${person.position || ''} ${person.department || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))

  async function enroll() {
    if (!enrolling || !consent) return
    await perform(async () => {
      const images = await capture()
      await attendanceApi.enroll(enrolling.id, images)
      setEnrolling(null); setConsent(false)
    })
  }

  function beginCorrection(item: AttendanceEvent) {
    setEditing(item)
    setEditKind(item.kind)
    setEditTime(localDateTime(item.occurred_at))
    setReason('')
  }

  return <div className="attendance-admin admin-page">
    <div className="admin-page__header"><div><h1>Учёт рабочего времени</h1><p>Фактические приходы и уходы сотрудников. Расписание приёма пациентов здесь не меняется.</p></div><Link className="attendance-button" to="/attendance/kiosk" target="_blank" rel="noreferrer">Открыть стойку</Link></div>
    <p className="attendance-admin__pilot-note">Первый скан записывает приход, следующий через 2 минуты — уход. При отметке система сверяет лицо без проверки движения; фотография или подменённое видео могут обмануть такую проверку. Подтверждайте регистрацию лица лично и проверяйте спорные отметки.</p>
    {error && <p className="attendance-error" role="alert">{error}</p>}

    {section === 'summary' && <>
    <section id="attendance-summary" className="attendance-admin__section">
      <div className="attendance-admin__section-heading"><div><h2>Сводка сегодня</h2><p>Фактическое присутствие по последним отметкам.</p></div><button type="button" onClick={() => void load().catch((err) => setError(errorText(err)))}>Обновить</button></div>
      {stats && <><div className="attendance-admin__stats">
        {[
          ['Сотрудников', stats.employees], ['На работе сейчас', stats.present], ['Пришли сегодня', stats.arrivals_today],
          ['Ушли сегодня', stats.departures_today], ['Лицо зарегистрировано', stats.enrolled], ['Заявки на лицо', stats.pending], ['Нужна проверка', stats.unresolved],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div><div className="attendance-admin__summary-grid"><div><h3>Последние 7 дней</h3><div className="attendance-admin__daily">{stats.daily.map((item) => <div key={item.date}><time>{new Date(`${item.date}T12:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</time><span>Приход {item.in}</span><span>Уход {item.out}</span></div>)}</div></div><div><h3>По отделениям</h3><div className="attendance-admin__daily">{stats.departments.map((item) => <div key={item.department_id}><span>{item.name}</span><span>{item.present} на работе</span><span>из {item.employees}</span></div>)}</div></div></div></>}
    </section>
    <section className="attendance-admin__section">
      <div className="attendance-admin__section-heading"><div><h2>Подробный отчёт по графику</h2><p>Первый приход и последний уход сравниваются с плановым временем в часовом поясе организации.</p></div><button type="button" onClick={downloadReport} disabled={!report?.rows.length}>Скачать CSV</button></div>
      <div className="attendance-admin__report-filters">
        <label>С даты<input type="date" value={reportFrom} max={reportTo} onChange={(event) => setReportFrom(event.target.value)} /></label>
        <label>По дату<input type="date" value={reportTo} min={reportFrom} onChange={(event) => setReportTo(event.target.value)} /></label>
        <label>Отделение<select value={reportDepartment} onChange={(event) => setReportDepartment(event.target.value)}><option value="">Все отделения</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      {report && <>
        {report.missing_schedule > 0 && <p className="attendance-admin__schedule-warning">Без графика: {report.missing_schedule}. Для этих сотрудников нельзя рассчитать опоздания и отсутствие — задайте график во вкладке «Сотрудники».</p>}
        <div className="attendance-admin__stats attendance-admin__report-stats">{[
          ['Смен по графику', report.totals.scheduled], ['Закрыто смен', report.totals.completed], ['Опозданий', report.totals.late],
          ['Ранних уходов', report.totals.early_leave], ['Отсутствий', report.totals.absent], ['Неполных отметок', report.totals.incomplete],
          ['Переработка', durationText(report.totals.overtime_minutes)],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        {report.rows.length === 0 ? <p className="attendance-empty">За выбранный период нет запланированных смен.</p> : <div className="attendance-table-scroll"><table className="attendance-table attendance-report-table"><thead><tr><th>Дата</th><th>Сотрудник</th><th>План</th><th>Факт</th><th>Отработано</th><th>Отклонение</th><th>Статус</th></tr></thead><tbody>{report.rows.map((item) => <tr key={`${item.date}-${item.employee_id}`}><td>{new Date(`${item.date}T12:00:00`).toLocaleDateString('ru-RU')}</td><td><strong>{item.employee_name}</strong><small>{item.department || 'Без отделения'}{item.position ? ` · ${item.position}` : ''}</small></td><td>{timeText(item.planned_start, report.timezone)}–{timeText(item.planned_end, report.timezone)}</td><td>Приход {timeText(item.first_in, report.timezone)}<br />Уход {timeText(item.last_out, report.timezone)}</td><td>{durationText(item.worked_minutes)}</td><td>{item.late_minutes ? `Опоздание ${item.late_minutes} мин` : ''}{item.early_leave_minutes ? <><br />Ранний уход {item.early_leave_minutes} мин</> : null}{item.overtime_minutes ? <><br />Переработка {item.overtime_minutes} мин</> : null}{!item.late_minutes && !item.early_leave_minutes && !item.overtime_minutes ? '—' : null}</td><td><span className={`attendance-report-status attendance-report-status--${item.status}`}>{REPORT_STATUS[item.status]}</span></td></tr>)}</tbody></table></div>}
        <small className="attendance-admin__timezone-note">Часовой пояс: {report.timezone}. Период отчёта ограничен 93 днями.</small>
      </>}
    </section>
    </>}

    {section === 'employees' && <>
    <section id="attendance-employees" className="attendance-admin__section">
      <div><h2>Сотрудники</h2><p>Сначала создайте отделения в разделе <Link to="/admin/signage">«ТВ и расписание»</Link>, затем добавьте сотрудников. Лицо можно зарегистрировать здесь или через отдельный QR.</p></div>
      <form className="attendance-admin__create" onSubmit={(event) => void create(event)}>
        <label>Имя и фамилия<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={200} required placeholder="Например, Айгуль Садыкова" /></label>
        <label>Отделение<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} required><option value="">Выберите отделение</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Должность<input value={position} onChange={(event) => setPosition(event.target.value)} maxLength={200} placeholder="Например, врач" /></label>
        <fieldset className="attendance-admin__schedule-fieldset"><legend>Рабочий график</legend><p>Отметьте рабочие дни и укажите, когда сотрудник должен приходить и уходить.</p><ScheduleEditor value={newSchedule} onChange={setNewSchedule} disabled={busy} /></fieldset>
        <button disabled={busy || !departmentId || newSchedule.length === 0 || newSchedule.some((item) => item.starts_at >= item.ends_at)}>Добавить сотрудника</button>
      </form>
      <p>{i18n.t('attendanceDirectory.employeeHint')} <Link to="/admin/attendance/departments">{i18n.t('attendanceDirectory.manage')}</Link></p>
      {departments.length === 0 && <p className="attendance-empty">{i18n.t('attendanceDirectory.emptyEmployees')}</p>}
      <details className="attendance-admin__import"><summary>Импорт сотрудников из Excel</summary><p>Скачайте шаблон. Столбцы: ФИО, Отделение, Должность. Названия отделений должны совпадать с существующими. При ошибке ни одна строка не будет добавлена.</p><a href="/api/attendance/admin/employees/template" download>Скачать шаблон Excel</a><form onSubmit={(event) => void importEmployees(event)}><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} aria-label="Excel-файл сотрудников" /><button disabled={busy || !importFile}>Импортировать</button></form></details>
      {importResult && <div className="attendance-admin__import-result" role="status"><strong>Добавлено сотрудников: {importResult.count}</strong><p>Скачайте коды сейчас и передайте каждому сотруднику лично. После закрытия страницы коды больше не показываются.</p><button type="button" onClick={downloadCodes}>Скачать список кодов</button><button type="button" onClick={() => setImportResult(null)}>Закрыть</button></div>}
      <div className="attendance-admin__filters"><label>Поиск<input type="search" placeholder="Имя или должность" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>Отделение<select value={filterDepartment} onChange={(event) => setFilterDepartment(event.target.value)}><option value="">Все отделения</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><span>Показано: {visibleEmployees.length} из {employees.length}</span></div>
      {visibleEmployees.length === 0 ? <p className="attendance-empty">{employees.length ? 'По фильтру сотрудники не найдены.' : 'Пока нет сотрудников. Добавьте первого человека в форме выше.'}</p> : <div className="attendance-admin__people">
        {visibleEmployees.map((person) => <article className="attendance-person" key={person.id}>
          <div><strong>{person.full_name}</strong><span>{person.department || 'Без отделения'}{person.position ? ` · ${person.position}` : ''}</span><small>{person.face_pending ? 'Лицо ожидает подтверждения' : person.face_enrolled ? 'Лицо зарегистрировано' : 'Лицо ещё не зарегистрировано'} · {person.is_active ? 'Активен' : 'Отключён'}{person.code_length !== 4 ? ' · замените старый код' : ''}</small><small className={person.schedule.length ? '' : 'attendance-person__schedule-missing'}>{scheduleText(person.schedule)}</small></div>
          <div className="attendance-person__actions">
            <button type="button" disabled={busy} onClick={() => { setEditingEmployee(person); setEditName(person.full_name); setEditDepartment(person.department_id || ''); setEditPosition(person.position || '') }}>Изменить</button>
            <button type="button" disabled={busy} onClick={() => { setScheduleEmployee(person); setEditSchedule(person.schedule.map((item) => ({ ...item }))) }}>График</button>
            {person.face_pending && <button type="button" disabled={busy} onClick={() => { setError(null); setIdentityChecked(false); setReviewing(person) }}>Проверить заявку</button>}
            <button type="button" disabled={busy} onClick={() => { setEnrolling(person); setConsent(false) }}>{person.face_enrolled ? 'Обновить лицо' : 'Зарегистрировать лицо'}</button>
            {person.face_enrolled && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Удалить данные лица ${person.full_name}? Отметка через камеру станет недоступна.`)) void perform(async () => { await attendanceApi.removeFace(person.id) }) }}>Удалить лицо</button>}
            <button type="button" disabled={busy} onClick={() => void perform(async () => { const result = await attendanceApi.resetCode(person.id); setRevealedCode({ name: person.full_name, code: result.code }) })}>Новый код</button>
            <button type="button" disabled={busy} onClick={() => void perform(async () => { await attendanceApi.updateEmployee(person.id, { is_active: !person.is_active }) })}>{person.is_active ? 'Отключить' : 'Включить'}</button>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Архивировать ${person.full_name}? История отметок останется.`)) void perform(async () => { await attendanceApi.archiveEmployee(person.id) }) }}>Архивировать</button>
          </div>
        </article>)}
      </div>}
    </section>
    </>}

    {section === 'events' && <>
    <section id="attendance-events" className="attendance-admin__section"><div className="attendance-admin__section-heading"><div><h2>Отметки</h2><p>Исправления сохраняются в журнале действий с причиной и именем администратора.</p></div><button type="button" onClick={() => { setManualEmployee(employees[0]?.id || ''); setManualKind('in'); setManualTime(localDateTime(new Date().toISOString())); setManualReason(''); setManualOpen(true) }} disabled={employees.length === 0}>Добавить отметку вручную</button></div>
      <div className="attendance-admin__filters"><label>Дата<input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label><button type="button" onClick={() => setDay('')}>Все даты</button><button type="button" onClick={() => void load().catch((err) => setError(errorText(err)))}>Обновить</button><span>Приходов: {events.filter((item) => item.kind === 'in').length} · Уходов: {events.filter((item) => item.kind === 'out').length}</span></div>
      {events.length === 0 ? <p className="attendance-empty">Пока нет отметок.</p> : <div className="attendance-table-scroll"><table className="attendance-table"><thead><tr><th>Сотрудник</th><th>Отметка</th><th>Время</th><th>Способ</th><th></th></tr></thead><tbody>{events.map((item) => <tr key={item.id}><td>{item.employee_name}{item.needs_review && <small className="attendance-review">Нужна проверка: нет ухода</small>}</td><td><span className={`attendance-badge attendance-badge--${item.kind}`}>{item.kind === 'in' ? 'Приход' : 'Уход'}</span></td><td>{new Date(item.occurred_at).toLocaleString('ru-RU')}</td><td>{item.source === 'phone' ? 'Телефон' : item.source === 'kiosk' ? 'Стойка' : 'Вручную'}{item.corrected_at && <small> · исправлено</small>}</td><td><button type="button" onClick={() => beginCorrection(item)}>Исправить</button></td></tr>)}</tbody></table></div>}
    </section>
    </>}

    {section === 'settings' && <>
    <section id="attendance-settings" className="attendance-admin__section">
      <h2>Настройки регистрации</h2>
      <p>Этот QR служит только для первой регистрации лица. Для прихода и ухода на стойке используется другой, меняющийся QR.</p>
      {settings && <div className="attendance-admin__settings">
        <div className="attendance-admin__qr-card">{enrollmentQr && <img src={enrollmentQr} alt="Статичный QR регистрации лица" />}<a href={`/attendance/enroll?token=${encodeURIComponent(settings.enrollment_token)}`} target="_blank" rel="noreferrer">Открыть страницу регистрации</a><small>Распечатайте QR или покажите сотруднику. После отправки заявки подтвердите личность лично.</small></div>
        <div className="attendance-admin__settings-controls">
          <label><input type="checkbox" checked={settings.enrollment_enabled} disabled={busy} onChange={(event) => { const enabled = event.target.checked; void perform(async () => { await attendanceApi.updateSettings({ enrollment_enabled: enabled }) }) }} />Разрешить регистрацию лица по QR</label>
          <label><input type="checkbox" checked={settings.enrollment_on_kiosk} disabled={busy} onChange={(event) => { const enabled = event.target.checked; void perform(async () => { await attendanceApi.updateSettings({ enrollment_on_kiosk: enabled }) }) }} />Показывать QR регистрации на экране стойки</label>
          <button type="button" disabled={busy} onClick={() => { if (window.confirm('Создать новый QR? Старый перестанет работать.')) void perform(async () => { await attendanceApi.rotateEnrollmentQr() }) }}>Сменить QR регистрации</button>
          <small>При выключенной регистрации уже подтверждённые сотрудники продолжат отмечаться.</small>
        </div>
      </div>}
    </section>
    <section className="attendance-admin__section">
      <h2>Место отметки с телефона</h2>
      <p>Задайте адрес организации как точку и радиус. При включении сотрудник сможет отметить приход или уход с телефона только рядом с этой точкой. Привязанные стойки работают без этой проверки.</p>
      <form className="attendance-admin__geo-form" onSubmit={(event) => { event.preventDefault(); void perform(async () => {
        await attendanceApi.updateSettings(geoEnabled ? {
          geo_enabled: true,
          geo_latitude: Number(geoLatitude),
          geo_longitude: Number(geoLongitude),
          geo_radius_m: Number(geoRadius),
        } : { geo_enabled: false })
      }) }}>
        <label className="attendance-admin__geo-toggle"><input type="checkbox" checked={geoEnabled} onChange={(event) => setGeoEnabled(event.target.checked)} disabled={busy} />Требовать геопозицию при отметке с телефона</label>
        <div className="attendance-admin__geo-fields">
          <label>Широта<input type="number" step="any" min={-90} max={90} value={geoLatitude} onChange={(event) => setGeoLatitude(event.target.value)} placeholder="Например, 43.2389" required={geoEnabled} /></label>
          <label>Долгота<input type="number" step="any" min={-180} max={180} value={geoLongitude} onChange={(event) => setGeoLongitude(event.target.value)} placeholder="Например, 76.8897" required={geoEnabled} /></label>
          <label>Радиус, м<input type="number" step={1} min={100} max={5000} value={geoRadius} onChange={(event) => setGeoRadius(event.target.value)} required={geoEnabled} /></label>
        </div>
        <div className="attendance-admin__geo-actions"><button type="button" className="attendance-preview-button" disabled={busy} onClick={() => { void getAttendanceLocation().then((location) => {
          setGeoLatitude(location.latitude.toFixed(6))
          setGeoLongitude(location.longitude.toFixed(6))
          setGeoAccuracy(Math.round(location.accuracy_m))
          setError(null)
        }).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Не удалось определить местоположение.')) }}>Взять моё местоположение</button>
          <button disabled={busy || (geoEnabled && (!geoLatitude || !geoLongitude || !geoRadius))}>Сохранить место отметки</button></div>
        {geoAccuracy !== null && <small>Точность найденной точки: около {geoAccuracy} м. Убедитесь, что вы находитесь по рабочему адресу.</small>}
        <small>Радиус можно увеличить, если геолокация внутри здания работает неточно. Местоположение сотрудника проверяется при отметке и не сохраняется в журнале.</small>
        <strong className={settings?.geo_enabled ? 'attendance-admin__geo-status is-on' : 'attendance-admin__geo-status'}>{settings?.geo_enabled ? 'Геоограничение включено' : 'Геоограничение выключено'}</strong>
      </form>
    </section>
    <section className="attendance-admin__section"><div className="attendance-admin__section-heading"><div><h2>Стойки регистрации</h2><p>Каждому компьютеру нужен отдельный код подключения. После отвязки старая стойка сразу перестанет работать.</p></div></div>
      <form className="attendance-admin__kiosk-create" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await attendanceApi.createKiosk(kioskName.trim()); setKioskName('') }) }}><label>Название стойки<input value={kioskName} onChange={(event) => setKioskName(event.target.value)} minLength={2} maxLength={120} required placeholder="Например, Регистратура 1" /></label><button disabled={busy || kioskName.trim().length < 2}>Добавить стойку</button></form>
      {kiosks.length === 0 ? <p className="attendance-empty">Стоек пока нет. Добавьте стойку и введите её код на компьютере регистратуры.</p> : <div className="attendance-admin__kiosk-list">{kiosks.map((kiosk) => <article key={kiosk.id} className="attendance-admin__kiosk-card"><div><strong>{kiosk.name}</strong><span>{kiosk.paired ? 'Подключена' : 'Ожидает подключения'}{kiosk.last_seen_at ? ` · последний сигнал ${new Date(kiosk.last_seen_at).toLocaleString('ru-RU')}` : ''}</span>{kiosk.pairing_code && <p>Код подключения: <b className="attendance-code">{kiosk.pairing_code}</b></p>}</div><div className="attendance-admin__kiosk-actions"><button type="button" disabled={busy} onClick={() => { if (window.confirm(kiosk.paired ? `Отвязать стойку «${kiosk.name}»? На ней потребуется ввести новый код.` : `Заменить код подключения стойки «${kiosk.name}»? Прежний код перестанет работать.`)) void perform(async () => { await attendanceApi.unpairKiosk(kiosk.id) }) }}>{kiosk.paired ? 'Отвязать' : 'Сменить код'}</button><button type="button" disabled={busy} onClick={() => { if (window.confirm(`Удалить стойку «${kiosk.name}»? Она сразу потеряет доступ.`)) void perform(async () => { await attendanceApi.archiveKiosk(kiosk.id) }) }}>Удалить</button></div></article>)}</div>}
    </section>
    </>}

    {revealedCode && <div className="attendance-dialog-backdrop"><div className="attendance-dialog" role="dialog" aria-modal="true" aria-label="Личный код сотрудника"><h2>Личный код</h2><p>Передайте код сотруднику лично. После закрытия окна он больше не будет показан.</p><strong className="attendance-code">{revealedCode.code}</strong><p>{revealedCode.name}</p><button type="button" onClick={() => setRevealedCode(null)}>Код записан</button></div></div>}
    {editingEmployee && <div className="attendance-dialog-backdrop"><form className="attendance-dialog" role="dialog" aria-modal="true" aria-label="Изменение сотрудника" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await attendanceApi.updateEmployee(editingEmployee.id, { full_name: editName.trim(), department_id: editDepartment || undefined, position: editPosition.trim() || null }); setEditingEmployee(null) }) }}><h2>Изменить сотрудника</h2><label>Имя и фамилия<input value={editName} onChange={(event) => setEditName(event.target.value)} minLength={2} maxLength={200} required /></label><label>Отделение<select value={editDepartment} onChange={(event) => setEditDepartment(event.target.value)}><option value="">Оставить прежнее</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Должность<input value={editPosition} onChange={(event) => setEditPosition(event.target.value)} maxLength={200} /></label><div className="attendance-dialog__actions"><button type="button" onClick={() => setEditingEmployee(null)}>Отмена</button><button disabled={busy}>Сохранить</button></div></form></div>}
    {scheduleEmployee && <div className="attendance-dialog-backdrop"><form className="attendance-dialog attendance-dialog--schedule" role="dialog" aria-modal="true" aria-label="Рабочий график сотрудника" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await attendanceApi.updateSchedule(scheduleEmployee.id, editSchedule); setScheduleEmployee(null) }) }}><h2>Рабочий график</h2><p>{scheduleEmployee.full_name}. Время указывается в часовом поясе организации.</p><ScheduleEditor value={editSchedule} onChange={setEditSchedule} disabled={busy} /><div className="attendance-dialog__actions"><button type="button" onClick={() => setScheduleEmployee(null)}>Отмена</button><button disabled={busy || editSchedule.length === 0 || editSchedule.some((item) => item.starts_at >= item.ends_at)}>Сохранить график</button></div></form></div>}
    {reviewing && <div className="attendance-dialog-backdrop"><div className="attendance-dialog attendance-dialog--review" role="dialog" aria-modal="true" aria-label="Проверка заявки на регистрацию лица"><h2>Проверка заявки</h2><div className="attendance-review-person"><strong>{reviewing.full_name}</strong><span>{reviewing.department || 'Без отделения'}{reviewing.position ? ` · ${reviewing.position}` : ''}</span><small>Отправлена {reviewing.pending_face_submitted_at ? new Date(reviewing.pending_face_submitted_at).toLocaleString('ru-RU') : 'недавно'}</small></div>{reviewLoading ? <p>Загружаем снимок…</p> : reviewImage ? <img className="attendance-review-photo" src={reviewImage} alt={`Лицо из заявки: ${reviewing.full_name}`} /> : <p className="attendance-error">Снимок недоступен. Отклоните заявку и попросите сотрудника зарегистрироваться заново.</p>}<p>Снимок показывает, какое лицо было отправлено, но сам по себе не подтверждает личность. Лично сверьте человека перед вами с кадровыми данными и снимком.</p><label className="attendance-consent"><input type="checkbox" checked={identityChecked} onChange={(event) => setIdentityChecked(event.target.checked)} disabled={!reviewImage || busy} />Я лично сверил сотрудника, его имя и лицо на снимке</label><div className="attendance-dialog__actions"><button type="button" onClick={closeReview} disabled={busy}>Закрыть</button><button type="button" onClick={() => void perform(async () => { await attendanceApi.rejectFace(reviewing.id); closeReview() })} disabled={busy}>Отклонить</button><button type="button" onClick={() => void perform(async () => { await attendanceApi.approveFace(reviewing.id); closeReview() })} disabled={busy || !reviewImage || !identityChecked}>Подтвердить</button></div></div></div>}
    {enrolling && <div className="attendance-dialog-backdrop"><div className="attendance-dialog" role="dialog" aria-modal="true" aria-label="Регистрация лица"><h2>Регистрация лица</h2><p>{enrolling.full_name} должен лично находиться перед камерой. Снимки будут обработаны для создания шаблона и не сохранятся.</p><video ref={videoRef} autoPlay muted playsInline className={`attendance-camera ${cameraActive ? 'is-active' : ''}`} /><button type="button" className="attendance-preview-button" onClick={() => cameraActive ? stopPreview() : void startPreview().catch((err) => setError(errorText(err)))} disabled={busy}>{cameraActive ? 'Выключить камеру' : 'Включить камеру и проверить кадр'}</button><label className="attendance-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Сотрудник дал согласие на обработку биометрии</label><div className="attendance-dialog__actions"><button type="button" onClick={() => { stopPreview(); setEnrolling(null) }} disabled={busy}>Отмена</button><button type="button" onClick={() => void enroll()} disabled={busy || !consent || !cameraActive}>Зарегистрировать</button></div></div></div>}
    {editing && <div className="attendance-dialog-backdrop"><form className="attendance-dialog" role="dialog" aria-modal="true" aria-label="Исправление отметки" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await attendanceApi.correct(editing.id, editKind, new Date(editTime).toISOString(), reason.trim()); setEditing(null) }) }}><h2>Исправить отметку</h2><p>{editing.employee_name}</p><label>Тип<select value={editKind} onChange={(event) => setEditKind(event.target.value as 'in' | 'out')}><option value="in">Приход</option><option value="out">Уход</option></select></label><label>Дата и время<input type="datetime-local" value={editTime} onChange={(event) => setEditTime(event.target.value)} required /></label><label>Причина<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} required placeholder="Например, сотрудник забыл отметить уход" /></label><div className="attendance-dialog__actions"><button type="button" onClick={() => setEditing(null)}>Отмена</button><button disabled={busy}>Сохранить исправление</button></div></form></div>}
    {manualOpen && <div className="attendance-dialog-backdrop"><form className="attendance-dialog" role="dialog" aria-modal="true" aria-label="Ручная отметка" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await attendanceApi.manualEvent(manualEmployee, manualKind, new Date(manualTime).toISOString(), manualReason.trim()); setManualOpen(false) }) }}><h2>Добавить отметку</h2><p>Используйте, если камера не сработала или сотрудник забыл отметиться.</p><label>Сотрудник<select value={manualEmployee} onChange={(event) => setManualEmployee(event.target.value)} required>{employees.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label><label>Тип<select value={manualKind} onChange={(event) => setManualKind(event.target.value as 'in' | 'out')}><option value="in">Приход</option><option value="out">Уход</option></select></label><label>Дата и время<input type="datetime-local" value={manualTime} onChange={(event) => setManualTime(event.target.value)} required /></label><label>Причина<input value={manualReason} onChange={(event) => setManualReason(event.target.value)} minLength={5} maxLength={500} required placeholder="Например, камера была недоступна" /></label><div className="attendance-dialog__actions"><button type="button" onClick={() => setManualOpen(false)}>Отмена</button><button disabled={busy}>Добавить отметку</button></div></form></div>}
  </div>
}
