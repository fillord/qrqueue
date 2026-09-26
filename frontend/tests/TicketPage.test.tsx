import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { TicketDetail } from '../src/api/types'
import i18n from '../src/app/i18n'
import { useTicket } from '../src/hooks/useTicket'
import TicketPage from '../src/pages/ticket/TicketPage'

vi.mock('../src/hooks/useTicket', () => ({ useTicket: vi.fn() }))
vi.mock('../src/components/PushOptInBanner', () => ({ default: () => null }))

const ticket: TicketDetail = {
  id: 'ticket-1', queue_id: 'queue-1', display_number: 'T-024', status: 'waiting',
  created_at: '2026-09-25T09:00:00Z', organization_name: 'Клиника', queue_name: 'Терапия',
  position: 3, queue_status: 'open', now_serving: 'T-021', estimated_wait_seconds: 600,
  cabinet: null, rating: null, next_ticket_id: null,
}

beforeEach(async () => { await i18n.changeLanguage('ru') })
afterEach(cleanup)

function mount() {
  return render(<MemoryRouter initialEntries={['/t/ticket-1']}><Routes>
    <Route path="/t/:id" element={<TicketPage />} />
  </Routes></MemoryRouter>)
}

it('keeps the queue, ticket number and waiting position readable on one pass', async () => {
  vi.mocked(useTicket).mockReturnValue({ ticket, loading: false, notFound: false, error: null })
  mount()
  expect(screen.getByText('Клиника')).toBeTruthy()
  expect(screen.getByText('Терапия')).toBeTruthy()
  expect(screen.getByText('T-024')).toBeTruthy()
  expect(screen.getByText('Ваше место в очереди')).toBeTruthy()
  expect(screen.getByText('T-021')).toBeTruthy()
})

it('shows the destination and confirmation action when called', () => {
  vi.mocked(useTicket).mockReturnValue({ ticket: { ...ticket, status: 'called', cabinet: { id: 'c-1', label: 'Кабинет 3' } }, loading: false, notFound: false, error: null })
  mount()
  expect(screen.getByText('Кабинет 3')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Я здесь' })).toBeTruthy()
})
