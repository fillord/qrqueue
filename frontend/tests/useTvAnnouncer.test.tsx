import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import '../src/app/i18n'
import { useTvAnnouncer } from '../src/hooks/useTvAnnouncer'
import type { TvActiveCall, TvState } from '../src/api/types'

const call = (id: string, count = 1): TvActiveCall => ({ ticket_id: id, display_number: 'A001', cabinet_label: id, call_count: count })
const state = (calls: TvActiveCall[]): TvState => ({ organization_name: 'Org', logo_url: null, brand_color: null, language: 'ru', is_hall_screen: false, timezone: 'Asia/Almaty', display_mode: 'queue', slide_seconds: 15, ads_enabled: false, departments: [], media: [], queues: [{ queue_id: 'q', queue_name: 'Queue', queue_status: 'open', now_serving: 'A001', now_serving_cabinet: '1', waiting_count: 0, active_calls: calls }] })
afterEach(() => vi.unstubAllGlobals())
it('announces simultaneous calls and recalls, but not initial state or unchanged snapshots', () => {
  const speak = vi.fn()
  vi.stubGlobal('speechSynthesis', { speak })
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  const { rerender } = renderHook(({ value, enabled }) => useTvAnnouncer(value, enabled), { initialProps: { value: state([call('1')]), enabled: true } })
  expect(speak).not.toHaveBeenCalled()
  rerender({ value: state([call('1'), call('2')]), enabled: true })
  expect(speak).toHaveBeenCalledTimes(1)
  rerender({ value: state([call('1', 2), call('2')]), enabled: true })
  expect(speak).toHaveBeenCalledTimes(2)
  rerender({ value: state([call('1', 2), call('2')]), enabled: true })
  expect(speak).toHaveBeenCalledTimes(2)
  rerender({ value: state([call('1', 3)]), enabled: false })
  rerender({ value: state([call('1', 3)]), enabled: true })
  expect(speak).toHaveBeenCalledTimes(2)
})
