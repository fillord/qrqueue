import { apiDelete, apiGet, apiPost } from './client'
import type { PushSubscriptionPayload } from '../lib/push'

export function getVapidPublicKey(): Promise<{ public_key: string | null }> {
  return apiGet<{ public_key: string | null }>('/api/public/push/vapid-key')
}

export function subscribePush(payload: PushSubscriptionPayload): Promise<void> {
  return apiPost<void>('/api/public/push/subscribe', payload)
}

export function unsubscribePush(endpoint: string): Promise<void> {
  return apiDelete<void>('/api/public/push/unsubscribe', { endpoint })
}
