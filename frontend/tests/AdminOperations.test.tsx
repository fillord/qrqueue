import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getAdminProblems, getDailyReport } from '../src/api/admin'
import i18n from '../src/app/i18n'
import AdminDailyReportPage from '../src/pages/admin/AdminDailyReportPage'
import AdminProblemsPage from '../src/pages/admin/AdminProblemsPage'

vi.mock('../src/api/admin', () => ({ getAdminProblems: vi.fn(), getDailyReport: vi.fn() }))

beforeEach(async () => { await i18n.changeLanguage('ru') })
afterEach(cleanup)

it('shows a concrete queue blocker and filters warnings', async () => {
  vi.mocked(getAdminProblems).mockResolvedValue({ generated_at: '2026-09-25T09:00:00Z', items: [
    { code: 'no_cabinet', severity: 'critical', name: 'Терапия', queue_id: 'q-1', screen_id: null, waiting_count: 3, wait_minutes: 8 },
    { code: 'screen_offline', severity: 'warning', name: 'Холл', queue_id: null, screen_id: 's-1', waiting_count: null, wait_minutes: null },
  ] })
  render(<MemoryRouter><AdminProblemsPage /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Нет работающего кабинета для «Терапия»' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Проверить кабинеты' }).getAttribute('href')).toBe('/admin/cabinets')
  fireEvent.click(screen.getByRole('button', { name: 'Предупреждения: 1' }))
  expect(screen.queryByText('Нет работающего кабинета для «Терапия»')).toBeNull()
  expect(screen.getByText('ТВ «Холл» без связи')).toBeTruthy()
})

it('shows a daily breakdown with an Excel download for the selected date', async () => {
  vi.mocked(getDailyReport).mockResolvedValue({
    day: '2026-09-24', organization_name: 'Клиника', timezone: 'Asia/Almaty',
    issued_count: 4, served_count: 2, no_show_count: 1, left_count: 0, active_count: 1,
    avg_wait_seconds: 300, avg_serving_seconds: 600,
    by_queue: [{ queue_id: 'q-1', name: 'Терапия', issued_count: 4, served_count: 2, no_show_count: 1, left_count: 0, active_count: 1, avg_wait_seconds: 300 }],
    by_operator: [{ operator_id: 'u-1', full_name: 'Айгуль', served_count: 2 }],
  })
  render(<MemoryRouter><AdminDailyReportPage /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Дневной отчёт' })).toBeTruthy()
  expect(await screen.findByRole('cell', { name: 'Терапия' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Скачать Excel' }).getAttribute('href')).toBe('/api/admin/daily-report.xlsx?day=2026-09-24&lang=ru')
  fireEvent.click(screen.getByText('По сотрудникам (1)'))
  expect(screen.getByRole('cell', { name: 'Айгуль' })).toBeTruthy()
})
