import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attendanceApi, type AttendanceReport, type Employee } from '../src/api/attendance'
import { ApiError } from '../src/api/client'
import i18n from '../src/app/i18n'
import AdminWorkforcePage from '../src/pages/admin/AdminWorkforcePage'

vi.mock('../src/api/attendance', () => ({ attendanceApi: { employees: vi.fn(), calendar: vi.fn(), saveCalendar: vi.fn(), resetCalendar: vi.fn(), telegram: vi.fn() } }))
const employee = { id: 'employee-1', full_name: 'Айгуль', department: 'Терапия', is_active: true, telegram_connected: false } as Employee
const report: AttendanceReport = {
  timezone: 'Asia/Almaty', date_from: '2026-10-01', date_to: '2026-10-31', missing_schedule: 0,
  totals: { scheduled: 1, completed: 1, absent: 0, late: 0, early_leave: 0, incomplete: 0, overtime_minutes: 0 },
  rows: [{ date: '2026-10-01', employee_id: employee.id, employee_name: employee.full_name, department: 'Терапия', position: null,
    planned_start: '2026-10-01T09:00:00+05:00', planned_end: '2026-10-01T18:00:00+05:00', planned_minutes: 540,
    first_in: null, last_out: null, worked_minutes: 480, late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0,
    status: 'completed', calendar_kind: 'shift', calendar_id: null, reason: null, needs_review: false, telegram_connected: false }],
}
beforeEach(async () => {
  vi.clearAllMocks(); await i18n.changeLanguage('ru')
  vi.mocked(attendanceApi.employees).mockResolvedValue([employee])
  vi.mocked(attendanceApi.calendar).mockResolvedValue(report)
  vi.mocked(attendanceApi.saveCalendar).mockResolvedValue({ days: 1 })
})
afterEach(cleanup)

it('saves approved leave without shift hours', async () => {
  render(<AdminWorkforcePage mode="calendar" />)
  await screen.findByRole('button', { name: 'Подключить Telegram' })
  fireEvent.change(screen.getAllByLabelText('Сотрудник')[1], { target: { value: employee.id } })
  fireEvent.change(screen.getByLabelText('Тип дня'), { target: { value: 'vacation' } })
  fireEvent.change(screen.getByLabelText('Основание (не менее 5 символов)'), { target: { value: 'Отпуск согласован' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить период' }))
  await waitFor(() => expect(attendanceApi.saveCalendar).toHaveBeenCalled())
  expect(vi.mocked(attendanceApi.saveCalendar).mock.calls[0][0]).toMatchObject({ employee_id: employee.id, kind: 'vacation', reason: 'Отпуск согласован' })
  expect(vi.mocked(attendanceApi.saveCalendar).mock.calls[0][0]).not.toHaveProperty('starts_at')
  await screen.findByText('Календарь сохранён')
})

it('selects a calendar day and restores its weekly template', async () => {
  vi.mocked(attendanceApi.calendar).mockResolvedValue({ ...report, rows: [{ ...report.rows[0], calendar_kind: 'sick', status: 'sick', calendar_id: 'day-1', planned_start: null, planned_end: null, reason: 'Подтверждён больничный' }] })
  Element.prototype.scrollIntoView = vi.fn()
  render(<AdminWorkforcePage mode="calendar" />)
  fireEvent.click(await screen.findByRole('button', { name: /Айгуль, 2026-10-01: Больничный/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Вернуть недельный график для выбранного дня' }))
  await waitFor(() => expect(attendanceApi.resetCalendar).toHaveBeenCalledWith('day-1', 'Подтверждён больничный'))
})

it('shows worked hours and flags incomplete marks in monthly timesheet', async () => {
  vi.mocked(attendanceApi.calendar).mockResolvedValue({ ...report, rows: [{ ...report.rows[0], needs_review: true }] })
  render(<AdminWorkforcePage mode="timesheet" />)
  expect(await screen.findByText('?')).toBeTruthy()
  expect(screen.getByText(/Есть неполные отметки/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Скачать Excel-табель' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Сохранить период' })).toBeNull()
})

it('explains missing Telegram setup without pretending delivery is active', async () => {
  vi.mocked(attendanceApi.telegram).mockRejectedValue(new ApiError(503, 'telegram_not_configured'))
  render(<AdminWorkforcePage mode="calendar" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Подключить Telegram' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Telegram ещё не настроен: нужен отдельный бот OmniBook.')
})
