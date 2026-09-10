import { apiGet, apiPost } from './client'
import type { ScanRequest, TicketDetail, TicketSummary } from './types'

export function scan(payload: ScanRequest): Promise<TicketSummary> {
  return apiPost<TicketSummary>('/api/public/scan', payload)
}

export function getMyTickets(): Promise<TicketSummary[]> {
  return apiGet<TicketSummary[]>('/api/public/me/tickets')
}

export function getTicket(id: string): Promise<TicketDetail> {
  return apiGet<TicketDetail>(`/api/public/tickets/${id}`)
}
