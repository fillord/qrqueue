import { apiDelete, apiGet, apiPatch, apiPost } from './client'

export interface KioskSettings {
  name: string; queue_ids: string[]; printing_enabled: boolean; paper_width: 58 | 80; language: 'ru' | 'kk' | 'en'
}
export interface QueueKiosk extends KioskSettings {
  id: string; paired: boolean; pairing_code: string | null; pairing_expires_at: string | null; last_seen_at: string | null
}
export interface KioskState {
  id: string; name: string; organization_name: string; language: 'ru' | 'kk' | 'en'; printing_enabled: boolean; paper_width: 58 | 80
  queues: { id: string; name: string; unavailable_reason: string | null }[]
}
export interface KioskIntent { queue_id: string; request_id: string; completedUntil?: number }
export interface KioskReceipt {
  request_id: string; ticket_id: string; queue_id: string; display_number: string; queue_name: string
  organization_name: string; created_at: string; timezone: string; ahead: number
  printing_enabled: boolean; paper_width: 58 | 80; language: 'ru' | 'kk' | 'en'
}
const headers = (token: string) => ({ 'X-Queue-Kiosk-Token': token })
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 15000)
  try { return await operation(controller.signal) }
  finally { window.clearTimeout(timer) }
}
export const queueKioskApi = {
  list: () => apiGet<QueueKiosk[]>('/api/admin/queue-kiosks'),
  create: (data: KioskSettings) => apiPost<QueueKiosk>('/api/admin/queue-kiosks', data),
  update: (id: string, data: KioskSettings) => apiPatch<QueueKiosk>(`/api/admin/queue-kiosks/${id}`, data),
  unpair: (id: string) => apiPost<QueueKiosk>(`/api/admin/queue-kiosks/${id}/unpair`),
  archive: (id: string) => apiDelete<void>(`/api/admin/queue-kiosks/${id}`),
  pair: (code: string) => bounded(signal => apiPost<{ device_token: string }>('/api/queue-kiosk/pair', { code }, undefined, signal)),
  state: (token: string) => bounded(signal => apiGet<KioskState>('/api/queue-kiosk/state', headers(token), signal)),
  issue: (token: string, intent: KioskIntent) => bounded(signal => apiPost<KioskReceipt>('/api/queue-kiosk/tickets', {
    queue_id: intent.queue_id, request_id: intent.request_id,
  }, headers(token), signal)),
  receipt: (token: string, id: string) => bounded(signal => apiGet<KioskReceipt>(`/api/queue-kiosk/receipts/${id}`, headers(token), signal)),
  print: (token: string, id: string) => bounded(signal => apiPost<KioskReceipt>(`/api/queue-kiosk/receipts/${id}/print`, undefined, headers(token), signal)),
}
