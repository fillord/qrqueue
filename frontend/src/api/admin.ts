import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import type { Analytics, AuditLogPage, Organization, QueueSummary, TvScreen } from './types'

export function getAdminQueues(organizationId?: string): Promise<QueueSummary[]> {
  const suffix = organizationId ? `?organization_id=${organizationId}` : ''
  return apiGet<QueueSummary[]>(`/api/admin/queues${suffix}`)
}

function orgSuffix(organizationId?: string): string {
  return organizationId ? `?organization_id=${organizationId}` : ''
}

export function getTvScreens(organizationId?: string): Promise<TvScreen[]> {
  return apiGet<TvScreen[]>(`/api/admin/tv-screens${orgSuffix(organizationId)}`)
}

export function createTvScreen(
  payload: { name: string; queue_id: string | null },
  organizationId?: string,
): Promise<TvScreen> {
  return apiPost<TvScreen>(`/api/admin/tv-screens${orgSuffix(organizationId)}`, payload)
}

export function deleteTvScreen(id: string, organizationId?: string): Promise<void> {
  return apiDelete<void>(`/api/admin/tv-screens/${id}${orgSuffix(organizationId)}`)
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
