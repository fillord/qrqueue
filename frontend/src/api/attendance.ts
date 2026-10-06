import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from './client'

export interface WorkScheduleDay {
  weekday: number
  starts_at: string
  ends_at: string
}

export interface Employee {
  id: string
  full_name: string
  department: string | null
  department_id: string | null
  position: string | null
  code_length: number
  user_id: string | null
  is_active: boolean
  face_enrolled: boolean
  face_pending: boolean
  face_review_photo_available: boolean
  pending_face_submitted_at: string | null
  deleted_at: string | null
  schedule: WorkScheduleDay[]
  telegram_connected?: boolean
}

export interface AttendanceDepartment {
  id: string
  name: string
  is_active: boolean
}

export type CalendarKind = 'shift' | 'off' | 'vacation' | 'sick' | 'absence'
export type AttendanceReportStatus = 'planned' | 'in_progress' | 'completed' | 'late' | 'early_leave' | 'late_early' | 'absent' | 'incomplete' | Exclude<CalendarKind, 'shift'>

export interface AttendanceReportRow {
  date: string
  employee_id: string
  employee_name: string
  department: string | null
  position: string | null
  planned_start: string | null
  planned_end: string | null
  planned_minutes: number
  calendar_kind: CalendarKind
  calendar_id: string | null
  reason: string | null
  needs_review: boolean
  telegram_connected: boolean
  first_in: string | null
  last_out: string | null
  worked_minutes: number | null
  late_minutes: number
  early_leave_minutes: number
  overtime_minutes: number
  status: AttendanceReportStatus
}

export interface AttendanceReport {
  timezone: string
  date_from: string
  date_to: string
  missing_schedule: number
  totals: { scheduled: number; completed: number; absent: number; late: number; early_leave: number; incomplete: number; overtime_minutes: number }
  rows: AttendanceReportRow[]
}

export interface AttendanceStats {
  employees: number; enrolled: number; pending: number; present: number
  arrivals_today: number; departures_today: number; unresolved: number
  daily: { date: string; in: number; out: number }[]
  departments: { department_id: string; name: string; employees: number; present: number }[]
}

export interface AttendanceSettings {
  enrollment_enabled: boolean
  enrollment_on_kiosk: boolean
  enrollment_token: string
  geo_enabled: boolean
  geo_latitude: number | null
  geo_longitude: number | null
  geo_radius_m: number | null
}

export interface AttendanceKiosk {
  id: string
  name: string
  pairing_code: string | null
  paired: boolean
  last_seen_at: string | null
}

async function kioskRequest<T>(path: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', 'X-Kiosk-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({})))?.detail
    throw new ApiError(response.status, typeof detail?.code === 'string' ? detail.code : 'kiosk_request_failed', undefined, undefined, {
      lastKind: detail?.last_kind === 'in' || detail?.last_kind === 'out' ? detail.last_kind : undefined,
      retryAt: typeof detail?.retry_at === 'string' ? detail.retry_at : undefined,
      employeeName: typeof detail?.employee_name === 'string' ? detail.employee_name : undefined,
    })
  }
  return response.json() as Promise<T>
}

export interface EmployeeImportResult {
  count: number
  employees: { full_name: string; department: string; code: string }[]
}

export async function importEmployeeFile(file: File): Promise<EmployeeImportResult> {
  const response = await fetch('/api/attendance/admin/employees/import', {
    method: 'POST', credentials: 'include', body: file,
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  })
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({})))?.detail
    throw new ApiError(response.status, typeof detail?.code === 'string' ? detail.code : 'employee_import_failed', undefined,
      typeof detail?.row === 'number' ? detail.row : undefined)
  }
  return response.json() as Promise<EmployeeImportResult>
}

export async function pendingFacePhoto(id: string): Promise<Blob> {
  const response = await fetch(`/api/attendance/admin/employees/${id}/pending-face-photo`, { credentials: 'include', cache: 'no-store' })
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({})))?.detail
    throw new ApiError(response.status, typeof detail?.code === 'string' ? detail.code : 'face_review_photo_unavailable')
  }
  return response.blob()
}

export interface AttendanceEvent {
  id: string
  employee_id: string
  employee_name: string
  kind: 'in' | 'out'
  source: 'phone' | 'kiosk' | 'manual'
  occurred_at: string
  corrected_at: string | null
  correction_reason: string | null
  needs_review: boolean
}

export const attendanceApi = {
  departments: () => apiGet<AttendanceDepartment[]>('/api/attendance/admin/departments'),
  createDepartment: (name: string) => apiPost<AttendanceDepartment>('/api/attendance/admin/departments', { name }),
  renameDepartment: (id: string, name: string) => apiPatch<AttendanceDepartment>(`/api/attendance/admin/departments/${id}`, { name }),
  archiveDepartment: (id: string) => apiDelete<void>(`/api/attendance/admin/departments/${id}`),
  restoreDepartment: (id: string) => apiPost<AttendanceDepartment>(`/api/attendance/admin/departments/${id}/restore`),
  calendar: (month: string) => apiGet<AttendanceReport>(`/api/attendance/admin/calendar?month=${encodeURIComponent(month)}`),
  saveCalendar: (body: { employee_id: string; date_from: string; date_to: string; kind: CalendarKind; starts_at?: string; ends_at?: string; reason: string }) => apiPost<{ days: number }>('/api/attendance/admin/calendar', body),
  resetCalendar: (id: string, reason: string) => apiPost(`/api/attendance/admin/calendar/${id}/reset`, { reason }),
  telegram: (id: string) => apiPost<{ url: string; expires_in: number }>(`/api/attendance/admin/employees/${id}/telegram`),
  employees: () => apiGet<Employee[]>('/api/attendance/admin/employees'),
  createEmployee: (body: { full_name: string; department_id: string; position?: string; schedule?: WorkScheduleDay[] }) => apiPost<Employee & { code: string }>('/api/attendance/admin/employees', body),
  updateEmployee: (id: string, body: Partial<Pick<Employee, 'full_name' | 'department_id' | 'position' | 'is_active'>>) => apiPatch<Employee>(`/api/attendance/admin/employees/${id}`, body),
  updateSchedule: (id: string, schedule: WorkScheduleDay[]) => apiPut<Employee>(`/api/attendance/admin/employees/${id}/schedule`, { schedule }),
  archiveEmployee: (id: string) => apiDelete<void>(`/api/attendance/admin/employees/${id}`),
  resetCode: (id: string) => apiPost<{ code: string }>(`/api/attendance/admin/employees/${id}/reset-code`),
  enroll: (id: string, images: string[]) => apiPost<Employee>(`/api/attendance/admin/employees/${id}/face`, { images, consent_confirmed: true }),
  removeFace: (id: string) => apiDelete<void>(`/api/attendance/admin/employees/${id}/face`),
  approveFace: (id: string) => apiPost<Employee>(`/api/attendance/admin/employees/${id}/approve-face`, { identity_checked: true }),
  rejectFace: (id: string) => apiPost<Employee>(`/api/attendance/admin/employees/${id}/reject-face`),
  stats: () => apiGet<AttendanceStats>('/api/attendance/admin/stats'),
  report: (dateFrom: string, dateTo: string, departmentId?: string) => apiGet<AttendanceReport>(`/api/attendance/admin/report?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}${departmentId ? `&department_id=${encodeURIComponent(departmentId)}` : ''}`),
  settings: () => apiGet<AttendanceSettings>('/api/attendance/admin/settings'),
  updateSettings: (body: Partial<Pick<AttendanceSettings, 'enrollment_enabled' | 'enrollment_on_kiosk' | 'geo_enabled' | 'geo_latitude' | 'geo_longitude' | 'geo_radius_m'>>) => apiPatch<AttendanceSettings>('/api/attendance/admin/settings', body),
  rotateEnrollmentQr: () => apiPost<AttendanceSettings>('/api/attendance/admin/settings/rotate-enrollment-qr'),
  enrollmentContext: (token: string) => apiGet<{ organization_name: string }>(`/api/attendance/enroll/context?token=${encodeURIComponent(token)}`),
  submitEnrollment: (token: string, code: string, images: string[]) => apiPost<{ status: string; employee_name: string }>('/api/attendance/enroll/submit', { token, code, images, consent_confirmed: true }),
  events: (day?: string) => apiGet<AttendanceEvent[]>(`/api/attendance/admin/events${day ? `?day=${encodeURIComponent(day)}` : ''}`),
  correct: (id: string, kind: 'in' | 'out', occurred_at: string, reason: string) => apiPatch<AttendanceEvent>(`/api/attendance/admin/events/${id}`, { kind, occurred_at, reason }),
  manualEvent: (employee_id: string, kind: 'in' | 'out', occurred_at: string, reason: string) => apiPost<AttendanceEvent>('/api/attendance/admin/events', { employee_id, kind, occurred_at, reason }),
  kiosks: () => apiGet<AttendanceKiosk[]>('/api/attendance/admin/kiosks'),
  createKiosk: (name: string) => apiPost<AttendanceKiosk>('/api/attendance/admin/kiosks', { name }),
  unpairKiosk: (id: string) => apiPost<AttendanceKiosk>(`/api/attendance/admin/kiosks/${id}/unpair`),
  archiveKiosk: (id: string) => apiDelete<void>(`/api/attendance/admin/kiosks/${id}`),
  pairKiosk: (code: string) => apiPost<{ device_token: string; name: string }>('/api/attendance/kiosk/pair', { code }),
  kioskState: (token: string) => kioskRequest<{ name: string }>('/api/attendance/kiosk/state', token),
  kioskQr: (token: string) => kioskRequest<{ token: string; expires_in: number }>('/api/attendance/kiosk/qr', token),
  kioskEnrollmentQr: (token: string) => kioskRequest<{ token: string | null }>('/api/attendance/kiosk/enrollment-qr', token),
  kioskMark: (token: string, images: string[]) => kioskRequest<AttendanceEvent>('/api/attendance/kiosk/mark', token, { images }),
  phoneContext: (token: string) => apiGet<{ organization_name: string; session_token: string; geo_required: boolean }>(`/api/attendance/phone/context?token=${encodeURIComponent(token)}`),
  phoneMark: (token: string, code: string, images: string[], location?: { latitude: number; longitude: number; accuracy_m: number }) => apiPost<AttendanceEvent>('/api/attendance/phone/mark', { token, code, images, ...location }),
}
