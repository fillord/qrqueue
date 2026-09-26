import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getAdminHome } from '../src/api/admin'
import type { AdminHomeData } from '../src/api/types'
import { listQueues } from '../src/api/queues'
import i18n from '../src/app/i18n'
import AdminHomePage from '../src/pages/admin/AdminHomePage'
import AdminQueuesPage from '../src/pages/admin/AdminQueuesPage'

vi.mock('../src/api/admin', () => ({ getAdminHome: vi.fn() }))
vi.mock('../src/api/queues', () => ({ listQueues: vi.fn(), createQueue: vi.fn(), updateQueue: vi.fn(), archiveQueue: vi.fn(), restoreQueue: vi.fn() }))

const empty: AdminHomeData = {
  organization_name: 'Клиника', queues: [], cabinet_count: 0, operator_count: 0,
  has_operator_assignment: false, paired_queue_screen_count: 0,
  paired_screen_count: 0, online_screen_count: 0, offline_screen_count: 0,
}

function mount() {
  return render(<MemoryRouter initialEntries={['/admin']}><Routes>
    <Route path="/admin" element={<AdminHomePage />} />
    <Route path="/admin/queues" element={<AdminQueuesPage />} />
  </Routes></MemoryRouter>)
}

beforeEach(async () => {
  await i18n.changeLanguage('ru')
  vi.mocked(getAdminHome).mockResolvedValue(empty)
  vi.mocked(listQueues).mockResolvedValue([])
})
afterEach(cleanup)

it('guides a new administrator into creating the first queue', async () => {
  mount()
  expect(await screen.findByRole('heading', { name: 'Настройте работу очереди' })).toBeTruthy()
  expect(screen.getByText('0 из 5 выполнено')).toBeTruthy()
  expect(screen.getByText('Следующий шаг')).toBeTruthy()

  fireEvent.click(screen.getByRole('link', { name: 'Создать очередь' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Новая очередь' })).toBeTruthy()
})

it('shows live queue and TV status once setup is complete', async () => {
  vi.mocked(getAdminHome).mockResolvedValue({
    ...empty,
    queues: [{ id: 'queue-1', name: 'Терапевт', status: 'open', waiting_count: 7 }],
    cabinet_count: 1, operator_count: 1, has_operator_assignment: true,
    paired_queue_screen_count: 1, paired_screen_count: 2,
    online_screen_count: 1, offline_screen_count: 1,
  })
  mount()
  expect(await screen.findByRole('heading', { name: 'Очереди работают' })).toBeTruthy()
  expect(screen.getByText('7 в ожидании')).toBeTruthy()
  expect(screen.getByText('ТВ без связи: 1.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Проверить экраны' }).getAttribute('href')).toBe('/admin/tv-screens')
  expect(screen.getByText('Проверить настройку')).toBeTruthy()
})
