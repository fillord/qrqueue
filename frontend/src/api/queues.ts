import { apiGet, apiPatch, apiPost, apiPut } from './client'
import type { AdminQueue, QueueStatus, ScheduleEntry, ScheduleEntryWithId } from './types'

export interface QueueCreatePayload {
  name: string
  ticket_prefix: string
  status?: QueueStatus
  latitude?: number | null
  longitude?: number | null
  geo_radius_m?: number | null
  // NOT NULL in the DB — omit the field to leave/default it, never send null.
  presence_timeout_min?: number
  daily_ticket_limit?: number | null
}

export type QueueUpdatePayload = Partial<QueueCreatePayload> & { is_active?: boolean }

export function listQueues(): Promise<AdminQueue[]> {
  return apiGet<AdminQueue[]>('/api/admin/queues')
}

export function getQueue(id: string): Promise<AdminQueue> {
  return apiGet<AdminQueue>(`/api/admin/queues/${id}`)
}

export function createQueue(payload: QueueCreatePayload): Promise<AdminQueue> {
  return apiPost<AdminQueue>('/api/admin/queues', payload)
}

export function updateQueue(id: string, payload: QueueUpdatePayload): Promise<AdminQueue> {
  return apiPatch<AdminQueue>(`/api/admin/queues/${id}`, payload)
}

export function getQueueSchedule(id: string): Promise<ScheduleEntryWithId[]> {
  return apiGet<ScheduleEntryWithId[]>(`/api/admin/queues/${id}/schedule`)
}

export function replaceQueueSchedule(id: string, schedule: ScheduleEntry[]): Promise<void> {
  return apiPut<void>(`/api/admin/queues/${id}/schedule`, { schedule })
}
