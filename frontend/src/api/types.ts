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
  estimated_wait_seconds: number | null
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

export interface TvQueueState {
  queue_id: string
  queue_name: string
  queue_status: QueueStatus
  now_serving: string | null
  now_serving_cabinet: string | null
  waiting_count: number
}

export interface TvState {
  organization_name: string
  logo_url: string | null
  brand_color: string | null
  queues: TvQueueState[]
}

export interface QrBatchToken {
  token: string
  nbf: string
  exp: string
}

export interface QrBatch {
  server_time: string
  tokens: QrBatchToken[]
}

export interface TvScreen {
  id: string
  organization_id: string
  queue_id: string | null
  name: string
  pairing_code: string | null
  language: 'kk' | 'ru' | 'en'
  last_seen_at: string | null
}

export interface Organization {
  id: string
  name: string
  slug: string
  timezone: string
  default_language: 'kk' | 'ru' | 'en'
  logo_url: string | null
  brand_color: string | null
  plan: 'trial' | 'basic' | 'pro'
  trial_ends_at: string | null
  one_ticket_per_org: boolean
  is_active: boolean
}

export interface OperatorStat {
  operator_id: string
  full_name: string
  served_count: number
  avg_serving_seconds: number | null
}

export interface HourlyPeak {
  hour: number
  count: number
}

export interface WeekdayPeak {
  weekday: number
  count: number
}

export interface Analytics {
  date_from: string
  date_to: string
  avg_wait_seconds: number | null
  avg_serving_seconds: number | null
  no_show_rate: number | null
  avg_rating: number | null
  ratings_count: number
  served_count: number
  no_show_count: number
  left_count: number
  by_operator: OperatorStat[]
  peaks_by_hour: HourlyPeak[]
  peaks_by_weekday: WeekdayPeak[]
}

export type AuditActorType = 'user' | 'client' | 'system'

export interface AuditLogItem {
  id: number
  organization_id: string | null
  actor_type: AuditActorType
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string
  payload: Record<string, unknown>
  ip: string | null
  created_at: string
}

export interface AuditLogPage {
  items: AuditLogItem[]
  total: number
  limit: number
  offset: number
}
