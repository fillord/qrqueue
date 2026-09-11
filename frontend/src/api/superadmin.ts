import { apiGet } from './client'
import type { Analytics, AuditLogPage, Organization } from './types'
import type { AuditLogQuery } from './admin'

export function getOrganizations(): Promise<Organization[]> {
  return apiGet<Organization[]>('/api/sa/organizations')
}

export interface SaAnalyticsQuery {
  from: string
  to: string
  organizationId?: string
  queueId?: string
}

export function getSaAnalytics(query: SaAnalyticsQuery): Promise<Analytics> {
  const params = new URLSearchParams({ from: query.from, to: query.to })
  if (query.organizationId) params.set('organization_id', query.organizationId)
  if (query.queueId) params.set('queue_id', query.queueId)
  return apiGet<Analytics>(`/api/sa/analytics?${params.toString()}`)
}

export interface SaAuditLogQuery extends AuditLogQuery {
  organizationId?: string
}

export function getSaAuditLogs(query: SaAuditLogQuery): Promise<AuditLogPage> {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) })
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  if (query.action) params.set('action', query.action)
  if (query.organizationId) params.set('organization_id', query.organizationId)
  return apiGet<AuditLogPage>(`/api/sa/audit-logs?${params.toString()}`)
}
