import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import type { AdminHomeData, AdminProblemsData, AdminQueue, Analytics, AuditLogPage, Cabinet, DailyReportData, Organization, TvScreen, TvState } from './types'

export function getAdminHome(): Promise<AdminHomeData> {
  return apiGet<AdminHomeData>('/api/admin/home')
}

export function getAdminProblems(): Promise<AdminProblemsData> {
  return apiGet<AdminProblemsData>('/api/admin/problems')
}

export function getDailyReport(day?: string): Promise<DailyReportData> {
  return apiGet<DailyReportData>(`/api/admin/daily-report${day ? `?day=${encodeURIComponent(day)}` : ''}`)
}

export function getAdminQueues(organizationId?: string): Promise<AdminQueue[]> {
  const suffix = organizationId ? `?organization_id=${organizationId}` : ''
  return apiGet<AdminQueue[]>(`/api/admin/queues${suffix}`)
}

export function getAdminCabinets(organizationId?: string): Promise<Cabinet[]> {
  return apiGet<Cabinet[]>(`/api/admin/cabinets${orgSuffix(organizationId)}`)
}

function orgSuffix(organizationId?: string): string {
  return organizationId ? `?organization_id=${organizationId}` : ''
}

export function getTvScreens(organizationId?: string): Promise<TvScreen[]> {
  return apiGet<TvScreen[]>(`/api/admin/tv-screens${orgSuffix(organizationId)}`)
}

export function getTvScreenPreview(id: string, organizationId?: string): Promise<TvState> {
  return apiGet<TvState>(`/api/admin/tv-screens/${id}/preview${orgSuffix(organizationId)}`)
}

export function createTvScreen(
  payload: { name: string; queue_id: string | null; language?: TvScreen['language']; display_mode?: TvScreen['display_mode']; slide_seconds?: number; ads_enabled?: boolean; media_playlist_mode?: TvScreen['media_playlist_mode']; selected_media_ids?: string[]; queue_selection_mode?: TvScreen['queue_selection_mode']; selected_queue_ids?: string[]; cabinet_selection_mode?: TvScreen['cabinet_selection_mode']; selected_cabinet_ids?: string[] },
  organizationId?: string,
): Promise<TvScreen> {
  return apiPost<TvScreen>(`/api/admin/tv-screens${orgSuffix(organizationId)}`, payload)
}

export function deleteTvScreen(id: string, organizationId?: string): Promise<void> {
  return apiDelete<void>(`/api/admin/tv-screens/${id}${orgSuffix(organizationId)}`)
}

export function unpairTvScreen(id: string, organizationId?: string): Promise<TvScreen> {
  return apiPost<TvScreen>(`/api/admin/tv-screens/${id}/unpair${orgSuffix(organizationId)}`)
}

export function getOwnOrganization(): Promise<Organization> {
  return apiGet<Organization>('/api/admin/organization')
}

export interface OrganizationSelfUpdatePayload {
  name?: string
  logo_url?: string | null
  brand_color?: string | null
  default_language?: 'kk' | 'ru' | 'en'
  timezone?: string
  one_ticket_per_org?: boolean
}

export function updateOwnOrganization(payload: OrganizationSelfUpdatePayload): Promise<Organization> {
  return apiPatch<Organization>('/api/admin/organization', payload)
}

export interface AnalyticsQuery {
  from: string
  to: string
  queueId?: string
}

function analyticsQueryString({ from, to, queueId }: AnalyticsQuery): string {
  const params = new URLSearchParams({ from, to })
  if (queueId) params.set('queue_id', queueId)
  return params.toString()
}

export function getAnalytics(query: AnalyticsQuery): Promise<Analytics> {
  return apiGet<Analytics>(`/api/admin/analytics?${analyticsQueryString(query)}`)
}

export interface AuditLogQuery {
  from?: string
  to?: string
  action?: string
  limit: number
  offset: number
}

function auditLogQueryString(query: AuditLogQuery): string {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) })
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  if (query.action) params.set('action', query.action)
  return params.toString()
}

export function getAuditLogs(query: AuditLogQuery): Promise<AuditLogPage> {
  return apiGet<AuditLogPage>(`/api/admin/audit-logs?${auditLogQueryString(query)}`)
}

export function updateTvScreen(id: string, payload: Partial<Pick<TvScreen, 'language' | 'display_mode' | 'slide_seconds' | 'ads_enabled' | 'media_playlist_mode' | 'selected_media_ids' | 'queue_id' | 'queue_selection_mode' | 'selected_queue_ids' | 'cabinet_selection_mode' | 'selected_cabinet_ids' | 'name'>>, organizationId?: string): Promise<TvScreen> {
  return apiPatch<TvScreen>(`/api/admin/tv-screens/${id}${orgSuffix(organizationId)}`, payload)
}
