const GEO_TIMEOUT_MS = 8000

export interface Coordinates {
  lat: number
  lng: number
}

function isSecureOrLocalhost(): boolean {
  const { protocol, hostname } = window.location
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1'
}

/**
 * Resolves to coordinates, or null on refusal, timeout, or an insecure
 * context — the backend decides what to do with a scan that has no
 * coordinates, this never blocks the scan itself.
 */
export function getGeolocation(): Promise<Coordinates | null> {
  return new Promise((resolve) => {
    if (!isSecureOrLocalhost() || !('geolocation' in navigator)) {
      resolve(null)
      return
    }

    let settled = false
    const finish = (value: Coordinates | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const timer = setTimeout(() => finish(null), GEO_TIMEOUT_MS)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer)
        finish({ lat: position.coords.latitude, lng: position.coords.longitude })
      },
      () => {
        clearTimeout(timer)
        finish(null)
      },
      { timeout: GEO_TIMEOUT_MS },
    )
  })
}
