const DEVICE_TOKEN_KEY = 'queue.tvDeviceToken'

export function rememberDeviceToken(token: string): void {
  try {
    localStorage.setItem(DEVICE_TOKEN_KEY, token)
  } catch {
    // private browsing / storage disabled — nothing to persist, harmless
  }
}

export function forgetDeviceToken(): void {
  try {
    localStorage.removeItem(DEVICE_TOKEN_KEY)
  } catch {
    // ignore
  }
}

export function getRememberedDeviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_TOKEN_KEY)
  } catch {
    return null
  }
}
