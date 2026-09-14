import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { getTicket } from '../src/api/public'
import type { TicketDetail } from '../src/api/types'
import { useTicket } from '../src/hooks/useTicket'
import { openReconnectingSocket } from '../src/lib/reconnectingWebSocket'

vi.mock('../src/api/public', () => ({ getTicket: vi.fn() }))
vi.mock('../src/lib/reconnectingWebSocket', () => ({
  wsBaseUrl: () => 'ws://localhost',
  openReconnectingSocket: vi.fn(() => ({ close: vi.fn() })),
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('does not overwrite transfer information with a stale REST snapshot', async () => {
  let resolve!: (ticket: TicketDetail) => void
  vi.mocked(getTicket).mockImplementation(() => new Promise((done) => { resolve = done }))
  const { result } = renderHook(() => useTicket('old'))
  const transferred = { id: 'old', status: 'transferred', next_ticket_id: 'new' } as TicketDetail
  act(() => vi.mocked(openReconnectingSocket).mock.calls[0][0].onMessage(transferred))
  await act(async () => resolve({ ...transferred, status: 'waiting', next_ticket_id: null }))
  expect(result.current.ticket?.next_ticket_id).toBe('new')
})
