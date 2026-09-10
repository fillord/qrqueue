export type TicketStatus =
  | 'waiting'
  | 'called'
  | 'confirmed'
  | 'serving'
  | 'served'
  | 'no_show'
  | 'left'
  | 'transferred'

export type QueueStatus = 'open' | 'paused' | 'closed'

export interface TicketSummary {
  id: string
  queue_id: string
  display_number: string
  status: TicketStatus
  created_at: string
}

export interface TicketDetail extends TicketSummary {
  position: number | null
  queue_status: QueueStatus
  now_serving: string | null
  estimated_wait_minutes: number | null
}

export interface ScanRequest {
  token: string
  lat?: number
  lng?: number
  fingerprint?: string
}
