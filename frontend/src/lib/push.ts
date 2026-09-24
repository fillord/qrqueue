export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Registers /sw.js (built from src/sw.ts, see vite.config.ts). Never throws
 * — callers just get null on unsupported/failed browsers and move on. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js', { type: 'module' })
  } catch {
    return null
  }
}

// Web Push wants the VAPID public key as a raw buffer, but the backend
// hands it over as a URL-safe base64 string — standard conversion. Typed as
// ArrayBuffer (not Uint8Array) since that's what pushManager.subscribe's
// BufferSource param actually wants — newer TS lib versions consider a bare
// Uint8Array's backing buffer possibly-shared and reject it here otherwise.
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray.buffer
}

export interface PushSubscriptionPayload {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Triggers the browser's permission prompt (if not already decided) and
 * subscribes. Returns null on denial, an unsupported browser, or any
 * failure — this must never throw into the caller. */
export async function subscribeToPush(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string,
): Promise<PushSubscriptionPayload | null> {
  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
    const json = subscription.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null
    return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }
  } catch {
    return null
  }
}
