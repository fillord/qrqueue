import { apiDelete, apiGet, apiPost } from './client'
import type { QueueSummary, TvScreen } from './types'

export function getAdminQueues(): Promise<QueueSummary[]> {
  return apiGet<QueueSummary[]>('/api/admin/queues')
}

export function getTvScreens(): Promise<TvScreen[]> {
  return apiGet<TvScreen[]>('/api/admin/tv-screens')
}

export function createTvScreen(payload: { name: string; queue_id: string | null }): Promise<TvScreen> {
  return apiPost<TvScreen>('/api/admin/tv-screens', payload)
}

export function deleteTvScreen(id: string): Promise<void> {
  return apiDelete<void>(`/api/admin/tv-screens/${id}`)
}
