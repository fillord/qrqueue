const CABINET_KEY = 'queue.operatorCabinetId'

export function rememberCabinetId(id: string): void {
  try {
    localStorage.setItem(CABINET_KEY, id)
  } catch {
    // private browsing / storage disabled — nothing to persist, harmless
  }
}

export function forgetCabinetId(): void {
  try {
    localStorage.removeItem(CABINET_KEY)
  } catch {
    // ignore
  }
}

export function getRememberedCabinetId(): string | null {
  try {
    return localStorage.getItem(CABINET_KEY)
  } catch {
    return null
  }
}
