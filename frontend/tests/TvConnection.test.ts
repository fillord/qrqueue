import { expect, it } from 'vitest'

import type { TvScreen } from '../src/api/types'
import { tvConnectionStatus } from '../src/lib/tvConnection'

const now = Date.parse('2026-09-24T10:00:00Z')
const screen = { pairing_code: null, last_seen_at: null } as TvScreen

it('distinguishes screens waiting for pairing from offline paired screens', () => {
  expect(tvConnectionStatus({ ...screen, pairing_code: '123456' }, now)).toBe('awaitingPairing')
  expect(tvConnectionStatus(screen, now)).toBe('offline')
})

it('marks a screen offline after two missed 30-second heartbeats plus jitter', () => {
  expect(tvConnectionStatus({ ...screen, last_seen_at: '2026-09-24T09:58:31Z' }, now)).toBe('online')
  expect(tvConnectionStatus({ ...screen, last_seen_at: '2026-09-24T09:58:29Z' }, now)).toBe('offline')
})
