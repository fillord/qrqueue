import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import type { Analytics, AuditLogPage, Organization, StaffUser } from './types'
import type { AuditLogQuery } from './admin'

export function getOrganizations(includeArchived = false): Promise<Organization[]> {
  return apiGet<Organization[]>(`/api/sa/organizations${includeArchived ? '?include_archived=true' : ''}`)
}

export function getOrganization(id: string): Promise<Organization> {
  return apiGet<Organization>(`/api/sa/organizations/${id}`)
}

export interface OrganizationCreatePayload {
  name: string
  slug?: string
  template?: 'blank' | 'clinic' | 'service_center'
}

export function createOrganization(payload: OrganizationCreatePayload): Promise<Organization> {
  return apiPost<Organization>('/api/sa/organizations', payload)
}

export function setOrganizationActive(id: string, isActive: boolean): Promise<Organization> {
  return apiPatch<Organization>(`/api/sa/organizations/${id}`, { is_active: isActive })
}

export type OrganizationEditPayload = Partial<Pick<Organization, 'name' | 'slug' | 'timezone' | 'default_language' | 'logo_url' | 'brand_color' | 'plan' | 'trial_ends_at' | 'one_ticket_per_org' | 'is_active' | 'video_large_upload_enabled'>>

export function updateOrganization(id: string, payload: OrganizationEditPayload): Promise<Organization> {
  return apiPatch<Organization>(`/api/sa/organizations/${id}`, payload)
}

export function archiveOrganization(id: string): Promise<void> {
  return apiDelete<void>(`/api/sa/organizations/${id}`)
}

export function restoreOrganization(id: string): Promise<Organization> {
  return apiPost<Organization>(`/api/sa/organizations/${id}/restore`)
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

export function updateOrgAdmin(organizationId: string, adminId: string, payload: { email?: string; full_name?: string; password?: string }): Promise<StaffUser> {
  return apiPatch<StaffUser>(`/api/sa/organizations/${organizationId}/admins/${adminId}`, payload)
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

export interface UserDirectoryEntry extends Omit<StaffUser, 'organization_id'> {
  organization_id: string | null
  organization_name: string | null
}

export type ManagedUserRole = 'org_admin' | 'operator' | 'registrar'
export interface ManagedUserCreate { email: string; password: string; full_name: string; role: ManagedUserRole; organization_id: string }
export interface ManagedUserUpdate { email?: string; password?: string; full_name?: string; role?: ManagedUserRole; is_active?: boolean; reset_totp?: boolean }

export function listAllUsers(includeArchived = false): Promise<UserDirectoryEntry[]> {
  return apiGet<UserDirectoryEntry[]>(`/api/sa/users${includeArchived ? '?include_archived=true' : ''}`)
}

export function createManagedUser(payload: ManagedUserCreate): Promise<UserDirectoryEntry> {
  return apiPost<UserDirectoryEntry>('/api/sa/users', payload)
}

export function updateManagedUser(id: string, payload: ManagedUserUpdate): Promise<UserDirectoryEntry> {
  return apiPatch<UserDirectoryEntry>(`/api/sa/users/${id}`, payload)
}

export function archiveManagedUser(id: string): Promise<void> {
  return apiDelete<void>(`/api/sa/users/${id}`)
}

export function restoreManagedUser(id: string): Promise<UserDirectoryEntry> {
  return apiPost<UserDirectoryEntry>(`/api/sa/users/${id}/restore`)
}
