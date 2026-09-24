import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import i18n from '../src/app/i18n'
import { ApiError } from '../src/api/client'
import { getScanOptions, scan } from '../src/api/public'
import { getGeolocation } from '../src/lib/geolocation'
import ScanPage from '../src/pages/scan/ScanPage'

vi.mock('../src/api/public', () => ({ getMyTickets: vi.fn(), getScanOptions: vi.fn(), scan: vi.fn() }))
vi.mock('../src/lib/geolocation', () => ({ getGeolocation: vi.fn() }))
vi.mock('../src/lib/ticketStorage', () => ({ rememberTicketId: vi.fn() }))

afterEach(cleanup)
beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(getGeolocation).mockResolvedValue(null)
})

it('shows the hall TV queues and joins only after the visitor chooses', async () => {
  vi.mocked(getScanOptions).mockResolvedValue({
    organization_name: 'Clinic', selection_token: 'selection-token',
    queues: [{ id: 'q1', name: 'Therapy', status: 'open', unavailable_reason: null },
             { id: 'q2', name: 'Surgery', status: 'paused', unavailable_reason: 'queue_paused' }],
  })
  vi.mocked(scan).mockResolvedValue({ id: 'ticket-1', queue_id: 'q1', display_number: 'A-001', status: 'waiting', created_at: '' })
  render(<MemoryRouter initialEntries={['/q?t=hall-token&mode=hall']}><Routes>
    <Route path="/q" element={<ScanPage />} />
    <Route path="/t/:id" element={<p>Ticket opened</p>} />
  </Routes></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Choose a queue' })).toBeTruthy()
  expect(scan).not.toHaveBeenCalled()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: /Surgery/ }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Therapy' }))
  await waitFor(() => expect(scan).toHaveBeenCalledWith({ token: 'selection-token', queue_id: 'q1', lat: undefined, lng: undefined }))
  expect(await screen.findByText('Ticket opened')).toBeTruthy()
})

it('continues to join a single-queue QR without a choice', async () => {
  vi.mocked(scan).mockResolvedValue({ id: 'ticket-2', queue_id: 'q2', display_number: 'B-001', status: 'waiting', created_at: '' })
  render(<MemoryRouter initialEntries={['/q?t=queue-token']}><Routes>
    <Route path="/q" element={<ScanPage />} />
    <Route path="/t/:id" element={<p>Ticket opened</p>} />
  </Routes></MemoryRouter>)
  await waitFor(() => expect(scan).toHaveBeenCalledWith({ token: 'queue-token', queue_id: undefined, lat: undefined, lng: undefined }))
  expect(getScanOptions).not.toHaveBeenCalled()
})

it('lets the visitor choose another queue after a daily-limit rejection', async () => {
  vi.mocked(getScanOptions).mockResolvedValue({
    organization_name: 'Clinic', selection_token: 'selection-token',
    queues: [{ id: 'q1', name: 'Therapy', status: 'open', unavailable_reason: null }],
  })
  vi.mocked(scan).mockRejectedValue(new ApiError(422, 'daily_limit_reached'))
  render(<MemoryRouter initialEntries={['/q?t=hall-token&mode=hall']}><Routes>
    <Route path="/q" element={<ScanPage />} />
  </Routes></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Therapy' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Choose another queue' }))
  expect(await screen.findByRole('heading', { name: 'Choose a queue' })).toBeTruthy()
})
