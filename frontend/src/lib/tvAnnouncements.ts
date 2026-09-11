const ENABLED_KEY = 'queue.tvAnnouncementsEnabled'

export function isAnnouncementsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(ENABLED_KEY)
    return stored === null ? true : stored === '1'
  } catch {
    return true
  }
}

export function setAnnouncementsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0')
  } catch {
    // private browsing / storage disabled — the toggle just won't persist
  }
}
