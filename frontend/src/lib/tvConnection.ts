import type { TvScreen } from '../api/types'

export type TvConnectionStatus = 'awaitingPairing' | 'online' | 'offline'

// A screen sends a heartbeat every 30 seconds. Allow two missed signals plus
// network jitter before marking it offline.
export const TV_OFFLINE_AFTER_MS = 90_000

export function tvConnectionStatus(screen: TvScreen, now = Date.now()): TvConnectionStatus {
  if (screen.pairing_code) return 'awaitingPairing'
  if (!screen.last_seen_at) return 'offline'
  const lastSeen = Date.parse(screen.last_seen_at)
  return Number.isFinite(lastSeen) && now - lastSeen <= TV_OFFLINE_AFTER_MS ? 'online' : 'offline'
}
