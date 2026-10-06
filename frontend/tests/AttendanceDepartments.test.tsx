import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attendanceApi } from '../src/api/attendance'
import { ApiError } from '../src/api/client'
import i18n from '../src/app/i18n'
import AdminAttendanceDepartmentsPage from '../src/pages/admin/AdminAttendanceDepartmentsPage'

vi.mock('../src/api/attendance', () => ({ attendanceApi: {
  departments: vi.fn(), createDepartment: vi.fn(), renameDepartment: vi.fn(), archiveDepartment: vi.fn(), restoreDepartment: vi.fn(),
} }))
const item = { id: 'attendance-1', name: 'Кадры', is_active: true }
beforeEach(async () => {
  vi.resetAllMocks(); await i18n.changeLanguage('ru')
  vi.mocked(attendanceApi.departments).mockResolvedValue([item])
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('creates a department using only the attendance API', async () => {
  render(<AdminAttendanceDepartmentsPage />)
  await screen.findByText('Кадры')
  expect(screen.getByText(/Не связан с расписаниями и экранами ТВ/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Название отделения'), { target: { value: '  Бухгалтерия  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Добавить отделение' }))
  await screen.findByText('Отделение добавлено')
  expect(attendanceApi.createDepartment).toHaveBeenCalledWith('Бухгалтерия')
})

it('renames an existing department inline', async () => {
  render(<AdminAttendanceDepartmentsPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Изменить название: Кадры' }))
  fireEvent.change(screen.getAllByLabelText('Название отделения')[1], { target: { value: 'Персонал' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByText('Название сохранено')
  expect(attendanceApi.renameDepartment).toHaveBeenCalledWith(item.id, 'Персонал')
})

it('explains why an assigned department cannot be archived', async () => {
  vi.mocked(attendanceApi.archiveDepartment).mockRejectedValue(new ApiError(409, 'attendance_department_has_employees'))
  render(<AdminAttendanceDepartmentsPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Архивировать: Кадры' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Сначала переведите сотрудников')
  expect(window.confirm).toHaveBeenCalledWith('Архивировать отделение «Кадры»?')
})

it('hides archived departments until requested and restores them', async () => {
  const archived = { id: 'archive-1', name: 'Архивный отдел', is_active: false }
  vi.mocked(attendanceApi.departments).mockResolvedValue([item, archived])
  render(<AdminAttendanceDepartmentsPage />)
  await screen.findByText('Кадры')
  expect(screen.queryByText(archived.name)).toBeNull()
  fireEvent.click(screen.getByLabelText('Показать архив'))
  fireEvent.click(screen.getByRole('button', { name: `Восстановить: ${archived.name}` }))
  await screen.findByText('Отделение восстановлено')
  expect(attendanceApi.restoreDepartment).toHaveBeenCalledWith(archived.id)
})

it('offers retry when loading fails and disables creation until loaded', async () => {
  vi.mocked(attendanceApi.departments).mockRejectedValueOnce(new Error('offline'))
  render(<AdminAttendanceDepartmentsPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить загрузку' }))
  await screen.findByText('Кадры')
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it.each(['ru', 'kk', 'en'])('has a complete %s translation dictionary', async (language) => {
  await i18n.changeLanguage(language)
  const base = Object.keys(i18n.getResourceBundle('ru', 'translation').attendanceDirectory).sort()
  expect(Object.keys(i18n.getResourceBundle(language, 'translation').attendanceDirectory).sort()).toEqual(base)
  render(<AdminAttendanceDepartmentsPage />)
  await screen.findByText('Кадры')
  expect(screen.getByRole('heading', { name: i18n.t('attendanceDirectory.title') })).toBeTruthy()
})
