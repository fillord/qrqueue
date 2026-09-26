const ENABLED_KEY = 'queue.tvAnnouncementsEnabled'
// Start from the working system voice after the previous automatic-selection bug.
const VOICE_KEY = 'queue.tvVoiceUri.v2'

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

export function getSelectedTvVoiceUri(): string {
  try {
    return localStorage.getItem(VOICE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setSelectedTvVoiceUri(voiceUri: string): void {
  try {
    localStorage.setItem(VOICE_KEY, voiceUri)
  } catch {
    // The choice still works until this page is closed.
  }
}
