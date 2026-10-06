import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { attendanceApi, type Employee } from '../src/api/attendance'
import { listDepartments } from '../src/api/signage'
import i18n from '../src/app/i18n'
import AdminAttendancePage from '../src/pages/admin/AdminAttendancePage'

vi.mock('../src/api/attendance', async original => ({ ...await original(), attendanceApi: {
  employees: vi.fn(), events: vi.fn(), stats: vi.fn(), departments: vi.fn(), settings: vi.fn(), kiosks: vi.fn(), createEmployee: vi.fn(),
} }))
vi.mock('../src/api/signage', () => ({ listDepartments: vi.fn() }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('') } }))
beforeEach(async () => {
  vi.clearAllMocks(); await i18n.changeLanguage('ru')
  vi.mocked(attendanceApi.employees).mockResolvedValue([])
  vi.mocked(attendanceApi.events).mockResolvedValue([])
  vi.mocked(attendanceApi.stats).mockResolvedValue({ employees: 0, enrolled: 0, pending: 0, present: 0, arrivals_today: 0, departures_today: 0, unresolved: 0, daily: [], departments: [] })
  vi.mocked(attendanceApi.departments).mockResolvedValue([{ id: 'hr-1', name: 'Кадровое отделение', is_active: true }])
  vi.mocked(attendanceApi.settings).mockResolvedValue({ enrollment_enabled: false, enrollment_on_kiosk: false, enrollment_token: '', geo_enabled: false, geo_latitude: null, geo_longitude: null, geo_radius_m: null })
  vi.mocked(attendanceApi.kiosks).mockResolvedValue([])
  vi.mocked(attendanceApi.createEmployee).mockResolvedValue({ id: 'person-1', full_name: 'Новый Сотрудник', code: '1234' } as Employee & { code: string })
})
afterEach(cleanup)

it('does not show the obsolete TV setup paragraph above the employee form', async () => {
  render(<MemoryRouter><AdminAttendancePage section="employees" /></MemoryRouter>)
  await screen.findAllByRole('option', { name: 'Кадровое отделение' })
  expect(screen.queryByRole('link', { name: '«ТВ и расписание»' })).toBeNull()
  expect(screen.queryByText(/Сначала создайте отделения в разделе/)).toBeNull()
  expect(screen.queryByText(/Лицо можно зарегистрировать здесь или через отдельный QR/)).toBeNull()
  expect(screen.getByRole('link', { name: 'Управление отделениями' }).getAttribute('href')).toBe('/admin/attendance/departments')
})

it('creates an attendance employee without querying TV schedules or doctors', async () => {
  render(<MemoryRouter><AdminAttendancePage section="employees" /></MemoryRouter>)
  await screen.findAllByRole('option', { name: 'Кадровое отделение' })
  expect(listDepartments).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: 'Управление отделениями' }).getAttribute('href')).toBe('/admin/attendance/departments')
  fireEvent.change(screen.getByLabelText('Имя и фамилия'), { target: { value: 'Новый Сотрудник' } })
  fireEvent.change(screen.getAllByLabelText('Отделение')[0], { target: { value: 'hr-1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Добавить сотрудника' }))
  await waitFor(() => expect(attendanceApi.createEmployee).toHaveBeenCalledWith(expect.objectContaining({ full_name: 'Новый Сотрудник', department_id: 'hr-1' })))
  expect(listDepartments).not.toHaveBeenCalled()
})

it('directs an empty directory to attendance departments rather than TV', async () => {
  vi.mocked(attendanceApi.departments).mockResolvedValue([])
  render(<MemoryRouter><AdminAttendancePage section="employees" /></MemoryRouter>)
  expect(await screen.findByText(/Нет действующих отделений учёта времени/)).toBeTruthy()
  expect(screen.queryByText(/Создайте отделение в разделе «ТВ/)).toBeNull()
  expect(listDepartments).not.toHaveBeenCalled()
})
