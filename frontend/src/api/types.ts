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

export interface AdminHomeData {
  organization_name: string
  queues: { id: string; name: string; status: QueueStatus; waiting_count: number }[]
  cabinet_count: number
  operator_count: number
  has_operator_assignment: boolean
  paired_queue_screen_count: number
  paired_screen_count: number
  online_screen_count: number
  offline_screen_count: number
}

export interface AdminProblem {
  code: 'queue_not_open' | 'no_cabinet' | 'long_wait' | 'screen_offline'
  severity: 'critical' | 'warning'
  name: string
  queue_id: string | null
  screen_id: string | null
  waiting_count: number | null
  wait_minutes: number | null
}

export interface AdminProblemsData {
  generated_at: string
  items: AdminProblem[]
}

export interface DailyReportData {
  day: string
  organization_name: string
  timezone: string
  issued_count: number
  served_count: number
  no_show_count: number
  left_count: number
  active_count: number
  avg_wait_seconds: number | null
  avg_serving_seconds: number | null
  by_queue: {
    queue_id: string; name: string; issued_count: number; served_count: number
    no_show_count: number; left_count: number; active_count: number; avg_wait_seconds: number | null
  }[]
  by_operator: { operator_id: string; full_name: string; served_count: number }[]
}

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
  organization_name: string
  queue_name: string
  position: number | null
  queue_status: QueueStatus
  now_serving: string | null
  estimated_wait_seconds: number | null
  cabinet: CabinetInfo | null
  rating: number | null
  next_ticket_id: string | null
}

export interface ScanRequest {
  token: string
  queue_id?: string
  lat?: number
  lng?: number
  fingerprint?: string
}

export interface ScanOptions {
  organization_name: string
  selection_token: string
  queues: { id: string; name: string; status: QueueStatus; unavailable_reason: 'queue_closed' | 'queue_paused' | 'outside_schedule' | 'daily_limit_reached' | null }[]
}

export interface User {
  id: string
  email: string
  full_name: string
  role: UserRole
  organization_id: string | null
  totp_enabled: boolean
  has_photo: boolean
  photo_revision: number
}

export interface TotpSetup {
  secret: string
  otpauth_uri: string
}

export interface LoginResult {
  totp_required: boolean
  totp_setup: TotpSetup | null
}

export interface Cabinet {
  id: string
  organization_id: string
  queue_id: string | null
  label: string
  status: CabinetStatus
  current_ticket_id: string | null
  is_active: boolean
  deleted_at: string | null
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

export interface AdminQueue {
  id: string
  organization_id: string
  name: string
  ticket_prefix: string
  status: QueueStatus
  latitude: number | null
  longitude: number | null
  geo_radius_m: number | null
  presence_timeout_min: number
  daily_ticket_limit: number | null
  last_ticket_number: number
  counter_date: string
  is_active: boolean
  deleted_at: string | null
  waiting_count: number
}

export interface ScheduleEntry {
  weekday: number
  opens_at: string
  closes_at: string
}

export interface ScheduleEntryWithId extends ScheduleEntry {
  id: string
}

export interface StaffUser {
  id: string
  email: string
  full_name: string
  role: UserRole
  organization_id: string
  is_active: boolean
  totp_enabled: boolean
  deleted_at: string | null
}

export interface TvActiveCall {
  ticket_id: string
  display_number: string
  cabinet_label: string | null
  call_count: number
}

export interface TvQueueState {
  active_calls: TvActiveCall[]
  queue_id: string
  queue_name: string
  queue_status: QueueStatus
  now_serving: string | null
  now_serving_cabinet: string | null
  waiting_count: number
}

export interface TvRecentCall {
  ticket_id: string
  display_number: string
  cabinet_label: string | null
  queue_name: string
}

export interface TvState {
  organization_name: string
  logo_url: string | null
  brand_color: string | null
  language: 'kk' | 'ru' | 'en'
  is_hall_screen: boolean
  queues: TvQueueState[]
  recent_calls: TvRecentCall[]
  timezone: string
  display_mode: 'queue' | 'schedule' | 'media'
  slide_seconds: number
  ads_enabled: boolean
  departments: TvDepartmentState[]
  media: TvMediaState[]
}

export interface TvScheduleEntry {
  id: string
  department_id: string
  doctor_name: string
  service_name: string | null
  room: string | null
  weekday: number
  starts_at: string
  ends_at: string
  sort_order: number
}

export interface TvDepartmentState { id: string; name: string; entries: TvScheduleEntry[] }
export interface TvMediaState { id: string; title: string; kind: 'youtube_video' | 'youtube_playlist' | 'advertisement'; mime_type: string; url: string }

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
  display_mode: 'queue' | 'schedule' | 'media'
  slide_seconds: number
  ads_enabled: boolean
  media_playlist_mode: 'all' | 'selected'
  selected_media_ids: string[]
  queue_selection_mode: 'all' | 'selected'
  selected_queue_ids: string[]
  cabinet_selection_mode: 'all' | 'selected'
  selected_cabinet_ids: string[]
  department_selection_mode: 'all' | 'selected'
  selected_department_ids: string[]
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
  deleted_at: string | null
  video_large_upload_enabled: boolean
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
  entity_label?: string | null
  queue_name?: string | null
  cabinet_label?: string | null
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
