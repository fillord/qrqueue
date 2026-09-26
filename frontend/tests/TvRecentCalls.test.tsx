import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import i18n from '../src/app/i18n'
import type { TvState } from '../src/api/types'
import { useTvState } from '../src/hooks/useTvState'
import TvPage from '../src/pages/tv/TvPage'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(async () => undefined) } }))
vi.mock('../src/hooks/useTvState', () => ({ useTvState: vi.fn() }))
vi.mock('../src/hooks/useLiveQr', () => ({ useLiveQr: () => ({ token: 'qr-token', offline: false }) }))
vi.mock('../src/hooks/useTvAnnouncer', () => ({ useTvAnnouncer: vi.fn() }))
vi.mock('../src/lib/tvDevice', () => ({ getRememberedDeviceToken: () => 'device-token', forgetDeviceToken: vi.fn() }))

const queue = {
  queue_id: 'queue-1', queue_name: 'Терапия', queue_status: 'open' as const,
  now_serving: 'A001', now_serving_cabinet: '101', waiting_count: 3,
  active_calls: [{ ticket_id: 'ticket-1', display_number: 'A001', cabinet_label: '101', call_count: 1 }],
}

const baseState: TvState = {
  organization_name: 'Клиника', logo_url: null, brand_color: null,
  language: 'ru', is_hall_screen: false, queues: [queue],
  recent_calls: [
    { ticket_id: 'ticket-3', display_number: 'A003', cabinet_label: '103', queue_name: 'Терапия' },
    { ticket_id: 'ticket-2', display_number: 'A002', cabinet_label: '102', queue_name: 'Терапия' },
  ],
  timezone: 'Asia/Almaty', display_mode: 'queue', slide_seconds: 15,
  ads_enabled: false, departments: [], media: [],
}

beforeEach(async () => { await i18n.changeLanguage('ru') })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

it('shows the last two calls while retaining older active calls on a single-queue TV', () => {
  vi.mocked(useTvState).mockReturnValue({ state: baseState, loading: false, rejected: false, offline: false })
  render(<MemoryRouter><TvPage /></MemoryRouter>)

  const recent = within(screen.getByRole('region', { name: 'Последние вызовы' }))
  expect(recent.getByText('Последний вызов')).toBeTruthy()
  expect(recent.getByText('A003')).toBeTruthy()
  expect(recent.getByText('Предыдущий вызов')).toBeTruthy()
  expect(recent.getByText('A002')).toBeTruthy()
  expect(screen.getByText('A001')).toBeTruthy()
  expect(document.querySelector('canvas.tv-screen__qr-canvas')).toBeTruthy()
})

it('labels recent calls with their queues on a hall TV', () => {
  vi.mocked(useTvState).mockReturnValue({
    state: { ...baseState, is_hall_screen: true, queues: [queue, { ...queue, queue_id: 'queue-2', queue_name: 'Хирургия' }],
      recent_calls: [baseState.recent_calls[0], { ...baseState.recent_calls[1], queue_name: 'Хирургия' }] },
    loading: false, rejected: false, offline: false,
  })
  render(<MemoryRouter><TvPage /></MemoryRouter>)
  const recent = within(screen.getByRole('region', { name: 'Последние вызовы' }))
  expect(recent.getByText('Терапия')).toBeTruthy()
  expect(recent.getByText('Хирургия')).toBeTruthy()
  expect(document.querySelector('aside.tv-screen__hall-qr canvas')).toBeTruthy()
})

it('spotlights new and repeated calls for four seconds, one after another, without audio', () => {
  vi.useFakeTimers()
  vi.mocked(useTvState).mockReturnValue({ state: baseState, loading: false, rejected: false, offline: false })
  const view = render(<MemoryRouter><TvPage /></MemoryRouter>)
  expect(document.querySelector('.tv-spotlight')).toBeNull()

  const secondCall = { ticket_id: 'ticket-2', display_number: 'A002', cabinet_label: '102', call_count: 1 }
  const thirdCall = { ticket_id: 'ticket-3', display_number: 'B003', cabinet_label: '203', call_count: 1 }
  const nextState: TvState = {
    ...baseState, is_hall_screen: true,
    queues: [
      { ...queue, active_calls: [...queue.active_calls, secondCall] },
      { ...queue, queue_id: 'queue-2', queue_name: 'Хирургия', active_calls: [thirdCall] },
    ],
  }
  vi.mocked(useTvState).mockReturnValue({ state: nextState, loading: false, rejected: false, offline: false })
  view.rerender(<MemoryRouter><TvPage /></MemoryRouter>)
  expect(within(screen.getByRole('status')).getByText('A002')).toBeTruthy()
  expect(within(screen.getByRole('status')).getByText('Кабинет: 102')).toBeTruthy()

  act(() => vi.advanceTimersByTime(4000))
  expect(within(screen.getByRole('status')).getByText('B003')).toBeTruthy()
  expect(within(screen.getByRole('status')).getByText('Хирургия')).toBeTruthy()

  act(() => vi.advanceTimersByTime(4000))
  expect(document.querySelector('.tv-spotlight')).toBeNull()

  const recalledState: TvState = {
    ...nextState,
    queues: [{ ...nextState.queues[0], active_calls: [
      { ...queue.active_calls[0], call_count: 2 }, secondCall,
    ] }, nextState.queues[1]],
  }
  vi.mocked(useTvState).mockReturnValue({ state: recalledState, loading: false, rejected: false, offline: false })
  view.rerender(<MemoryRouter><TvPage /></MemoryRouter>)
  expect(within(screen.getByRole('status')).getByText('A001')).toBeTruthy()
  act(() => vi.advanceTimersByTime(4000))
  expect(document.querySelector('.tv-spotlight')).toBeNull()
  view.rerender(<MemoryRouter><TvPage /></MemoryRouter>)
  expect(document.querySelector('.tv-spotlight')).toBeNull()
})
