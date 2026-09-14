import { StrictMode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLiveQr } from '../src/hooks/useLiveQr'

function batch(start = Date.now(), count = 20) {
  return {
    server_time: new Date(start).toISOString(),
    tokens: Array.from({ length: count }, (_, i) => ({
      token: `${start}:${i}`,
      nbf: new Date(start + i * 45000).toISOString(),
      exp: new Date(start + (i + 1) * 45000 + 15000).toISOString(),
    })),
  }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { cleanup(); vi.useRealTimers() })

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe('live QR', () => {
  it('switches at nbf, keeping a valid code throughout overlapping windows', async () => {
    const fetch = vi.fn().mockResolvedValue(batch())
    const { result } = renderHook(() => useLiveQr(fetch))
    await advance(0)
    expect(result.current.token).toBe('0:0')
    await advance(45000)
    expect(result.current.token).toBe('0:1')
    await advance(15000)
    expect(result.current.token).toBe('0:1')
    await advance(30000)
    expect(result.current.token).toBe('0:2')
  })

  it('uses server time even when the device clock is wrong', async () => {
    const fetch = vi.fn().mockResolvedValue(batch(1000000))
    const { result } = renderHook(() => useLiveQr(fetch))
    await advance(45000)
    expect(result.current.token).toBe('1000000:1')
  })

  it('keeps rotating offline, retries at most every 5s, and clears expired codes', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(batch(0, 2)).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useLiveQr(fetch))
    await advance(45000)
    expect(result.current.token).toBe('0:1')
    expect(result.current.offline).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(10)
    await advance(60000)
    expect(result.current.token).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(22)
    fetch.mockImplementation(async () => batch())
    await advance(5000)
    expect(result.current.offline).toBe(false)
    expect(result.current.token).toBe('110000:0')
  })

  it('clears the code on expiry even when the refresh request hangs', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(batch(0, 1)).mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useLiveQr(fetch))
    await advance(60000)
    expect(result.current.token).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not request QR for hall screens or after unmount', async () => {
    const fetch = vi.fn().mockResolvedValue(batch())
    const { rerender, unmount } = renderHook(({ enabled }) => useLiveQr(fetch, enabled), { initialProps: { enabled: false } })
    await advance(10000)
    expect(fetch).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await advance(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    unmount()
    await advance(1000000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('ignores the response of a cleaned-up StrictMode effect', async () => {
    let resolveOld!: (value: ReturnType<typeof batch>) => void
    const fetch = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve })).mockResolvedValue(batch(1000))
    const { result } = renderHook(() => useLiveQr(fetch), { wrapper: StrictMode })
    await advance(0)
    expect(result.current.token).toBe('1000:0')
    await act(async () => resolveOld(batch(0)))
    expect(result.current.token).toBe('1000:0')
  })
})
