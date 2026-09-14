import { apiGet, apiPatch, apiPost } from './client'
import type { StaffUser } from './types'

export interface StaffCreatePayload {
  email: string
  password: string
  full_name: string
  role: 'operator' | 'registrar'
}

export interface StaffUpdatePayload {
  full_name?: string
  password?: string
  role?: 'operator' | 'registrar'
  is_active?: boolean
  reset_totp?: boolean
}

export function listStaff(): Promise<StaffUser[]> {
  return apiGet<StaffUser[]>('/api/admin/users')
}

export function createStaff(payload: StaffCreatePayload): Promise<StaffUser> {
  return apiPost<StaffUser>('/api/admin/users', payload)
}

export function updateStaff(id: string, payload: StaffUpdatePayload): Promise<StaffUser> {
  return apiPatch<StaffUser>(`/api/admin/users/${id}`, payload)
}
