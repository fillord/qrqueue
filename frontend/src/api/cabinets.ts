import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import type { Cabinet, CabinetStatus, StaffUser } from './types'

export interface CabinetCreatePayload {
  label: string
  queue_id: string | null
}

export interface CabinetUpdatePayload {
  label?: string
  queue_id?: string | null
  status?: CabinetStatus
  is_active?: boolean
}

export function listCabinets(): Promise<Cabinet[]> {
  return apiGet<Cabinet[]>('/api/admin/cabinets')
}

export function createCabinet(payload: CabinetCreatePayload): Promise<Cabinet> {
  return apiPost<Cabinet>('/api/admin/cabinets', payload)
}

export function updateCabinet(id: string, payload: CabinetUpdatePayload): Promise<Cabinet> {
  return apiPatch<Cabinet>(`/api/admin/cabinets/${id}`, payload)
}

export function listCabinetOperators(id: string): Promise<StaffUser[]> {
  return apiGet<StaffUser[]>(`/api/admin/cabinets/${id}/operators`)
}

export function assignCabinetOperator(cabinetId: string, userId: string): Promise<void> {
  return apiPost<void>(`/api/admin/cabinets/${cabinetId}/operators/${userId}`)
}

export function unassignCabinetOperator(cabinetId: string, userId: string): Promise<void> {
  return apiDelete<void>(`/api/admin/cabinets/${cabinetId}/operators/${userId}`)
}
