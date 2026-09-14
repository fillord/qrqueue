import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ApiError } from '../src/api/client'
import { getTvState } from '../src/api/tv'
import { useTvState } from '../src/hooks/useTvState'
import { openReconnectingSocket } from '../src/lib/reconnectingWebSocket'

vi.mock('../src/api/tv', () => ({ getTvState: vi.fn() }))
vi.mock('../src/lib/reconnectingWebSocket', () => ({
  wsBaseUrl: () => 'ws://localhost',
  openReconnectingSocket: vi.fn(() => ({ close: vi.fn() })),
}))
const snapshot = { organization_name: 'Test', language: 'ru', queues: [], is_hall_screen: true, logo_url: null, brand_color: null } as const
beforeEach(() => { vi.useFakeTimers(); vi.mocked(getTvState).mockReset(); vi.mocked(openReconnectingSocket).mockClear() })
afterEach(() => { cleanup(); vi.useRealTimers() })

it.each([new TypeError('Failed to fetch'), new ApiError(503, 'unavailable')])('preserves pairing on transient errors and recovers', async (error) => {
  vi.mocked(getTvState).mockRejectedValueOnce(error).mockResolvedValue({ ...snapshot, queues: [] })
  const { result } = renderHook(() => useTvState('device'))
  await act(async () => {})
  expect(result.current.rejected).toBe(false)
  expect(result.current.offline).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(result.current.state?.organization_name).toBe('Test')
  expect(result.current.offline).toBe(false)
})

it('rejects an invalid device token without retrying', async () => {
  vi.mocked(getTvState).mockRejectedValue(new ApiError(401, 'invalid_device'))
  const { result } = renderHook(() => useTvState('invalid'))
  await act(async () => {})
  expect(result.current.rejected).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(getTvState).toHaveBeenCalledTimes(1)
})

it('does not replace a live snapshot with an older failed REST request', async () => {
  let reject!: (reason: Error) => void
  vi.mocked(getTvState).mockImplementation(() => new Promise((_, fail) => { reject = fail }))
  const { result } = renderHook(() => useTvState('device'))
  act(() => vi.mocked(openReconnectingSocket).mock.calls[0][0].onMessage(snapshot))
  await act(async () => reject(new ApiError(401, 'stale')))
  expect(result.current.rejected).toBe(false)
  expect(result.current.state?.organization_name).toBe('Test')
})

it('makes no requests until a device is paired', async () => {
  renderHook(() => useTvState(''))
  expect(getTvState).not.toHaveBeenCalled()
  expect(openReconnectingSocket).not.toHaveBeenCalled()
})
