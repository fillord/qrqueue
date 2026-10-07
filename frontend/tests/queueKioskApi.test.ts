import { afterEach, expect, it, vi } from 'vitest'
import { apiGet } from '../src/api/client'
import { queueKioskApi } from '../src/api/queueKiosk'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('does not sign staff out when an independent kiosk credential is revoked', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'kiosk_not_paired' }), { status: 401 })))
  const dispatch = vi.spyOn(window, 'dispatchEvent')
  await expect(queueKioskApi.state('test-device')).rejects.toMatchObject({ status: 401 })
  expect(dispatch).not.toHaveBeenCalled()
  await expect(apiGet('/api/auth/me')).rejects.toMatchObject({ status: 401 })
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'api:unauthorized' }))
})

it('aborts a stuck issuance so it can be retried with the same durable request ID', async () => {
  vi.useFakeTimers()
  const fetchMock = vi.fn((_path: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')))
  }))
  vi.stubGlobal('fetch', fetchMock)
  const pending = queueKioskApi.issue('test-device', { queue_id: 'queue', request_id: 'same-id' })
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(15000)
  await rejected
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ queue_id: 'queue', request_id: 'same-id' }))
})
