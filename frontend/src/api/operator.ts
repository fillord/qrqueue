import { apiGet, apiPost } from './client'
import type { Cabinet, OperatorQueue, QueueSummary, TicketSummary } from './types'

export function getCabinets(): Promise<Cabinet[]> {
  return apiGet<Cabinet[]>('/api/operator/cabinets')
}

export function selectCabinet(cabinetId: string): Promise<Cabinet> {
  return apiPost<Cabinet>(`/api/operator/cabinets/${cabinetId}/select`)
}

export function getOperatorQueue(): Promise<OperatorQueue> {
  return apiGet<OperatorQueue>('/api/operator/queue')
}

export function getOperatorQueues(): Promise<QueueSummary[]> {
  return apiGet<QueueSummary[]>('/api/operator/queues')
}

export function callNext(): Promise<TicketSummary> {
  return apiPost<TicketSummary>('/api/operator/call-next')
}

export function recallTicket(ticketId: string): Promise<TicketSummary> {
  return apiPost<TicketSummary>(`/api/operator/tickets/${ticketId}/recall`)
}

export function markNoShow(ticketId: string): Promise<TicketSummary> {
  return apiPost<TicketSummary>(`/api/operator/tickets/${ticketId}/no-show`)
}

export function returnTicket(ticketId: string): Promise<TicketSummary> {
  return apiPost<TicketSummary>(`/api/operator/tickets/${ticketId}/return`)
}

export function startServing(ticketId: string): Promise<TicketSummary> {
  return apiPost<TicketSummary>(`/api/operator/tickets/${ticketId}/start`)
}

export function finishServing(ticketId: string): Promise<TicketSummary> {
  return apiPost<TicketSummary>(`/api/operator/tickets/${ticketId}/finish`)
}

export function transferTicket(ticketId: string, queueId: string): Promise<TicketSummary> {
  return apiPost<TicketSummary>(`/api/operator/tickets/${ticketId}/transfer`, { queue_id: queueId })
}

export function pauseCabinet(reason?: string): Promise<Cabinet> {
  return apiPost<Cabinet>('/api/operator/cabinet/pause', reason ? { reason } : undefined)
}

export function resumeCabinet(): Promise<Cabinet> {
  return apiPost<Cabinet>('/api/operator/cabinet/resume')
}
