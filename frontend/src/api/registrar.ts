import { apiGet, apiPost } from './client'
import type { QueueSummary, TicketSummary } from './types'

export function getRegistrarQueues(): Promise<QueueSummary[]> {
  return apiGet<QueueSummary[]>('/api/registrar/queues')
}

export function createRegistrarTicket(queueId: string, note?: string): Promise<TicketSummary> {
  return apiPost<TicketSummary>('/api/registrar/tickets', { queue_id: queueId, note: note || undefined })
}

export function getRegistrarTicket(id: string): Promise<TicketSummary> {
  return apiGet<TicketSummary>(`/api/registrar/tickets/${id}`)
}
