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

export type CabinetStatus = 'free' | 'busy' | 'paused' | 'offline'

export type UserRole = 'superadmin' | 'org_admin' | 'operator' | 'registrar'

export interface TicketSummary {
  id: string
  queue_id: string
  display_number: string
  status: TicketStatus
  created_at: string
}

export interface CabinetInfo {
  id: string
  label: string
}

export interface TicketDetail extends TicketSummary {
  position: number | null
  queue_status: QueueStatus
  now_serving: string | null
  estimated_wait_minutes: number | null
  cabinet: CabinetInfo | null
}

export interface ScanRequest {
  token: string
  lat?: number
  lng?: number
  fingerprint?: string
}

export interface User {
  id: string
  email: string
  full_name: string
  role: UserRole
  organization_id: string | null
}

export interface LoginResult {
  totp_required: boolean
}

export interface Cabinet {
  id: string
  organization_id: string
  queue_id: string | null
  label: string
  status: CabinetStatus
  current_ticket_id: string | null
  is_active: boolean
}

export interface OperatorTicket extends TicketSummary {
  called_at: string | null
  call_count: number
}

export interface OperatorQueue {
  queue_id: string
  queue_status: QueueStatus
  cabinet_status: CabinetStatus
  current_ticket: OperatorTicket | null
  waiting: OperatorTicket[]
  waiting_count: number
  no_show: OperatorTicket[]
}

export interface QueueSummary {
  id: string
  name: string
  status: QueueStatus
}
