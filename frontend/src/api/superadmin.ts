import { apiGet, apiPatch, apiPost } from './client'
import type { Analytics, AuditLogPage, Organization, StaffUser } from './types'
import type { AuditLogQuery } from './admin'

export function getOrganizations(): Promise<Organization[]> {
  return apiGet<Organization[]>('/api/sa/organizations')
}

export function getOrganization(id: string): Promise<Organization> {
  return apiGet<Organization>(`/api/sa/organizations/${id}`)
}

export interface OrganizationCreatePayload {
  name: string
  slug?: string
}

export function createOrganization(payload: OrganizationCreatePayload): Promise<Organization> {
  return apiPost<Organization>('/api/sa/organizations', payload)
}

export function setOrganizationActive(id: string, isActive: boolean): Promise<Organization> {
  return apiPatch<Organization>(`/api/sa/organizations/${id}`, { is_active: isActive })
}

export function listOrgAdmins(organizationId: string): Promise<StaffUser[]> {
  return apiGet<StaffUser[]>(`/api/sa/organizations/${organizationId}/admins`)
}

export interface AdminCreatePayload {
  email: string
  password: string
  full_name: string
}

export function createOrgAdmin(organizationId: string, payload: AdminCreatePayload): Promise<StaffUser> {
  return apiPost<StaffUser>(`/api/sa/organizations/${organizationId}/admins`, payload)
}

export function setOrgAdminActive(
  organizationId: string,
  adminId: string,
  isActive: boolean,
): Promise<StaffUser> {
  return apiPatch<StaffUser>(`/api/sa/organizations/${organizationId}/admins/${adminId}`, {
    is_active: isActive,
  })
}

export function resetOrgAdminTotp(organizationId: string, adminId: string): Promise<StaffUser> {
  return apiPatch<StaffUser>(`/api/sa/organizations/${organizationId}/admins/${adminId}`, {
    reset_totp: true,
  })
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
