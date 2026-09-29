import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from './client'
import type { TvScheduleEntry } from './types'

export interface Department { id: string; organization_id: string; name: string; sort_order: number; is_active: boolean }
export interface MediaAsset {
  id: string; organization_id: string; title: string; kind: 'video' | 'advertisement' | 'youtube_video' | 'youtube_playlist'; youtube_id: string | null;
  mime_type: string; size_bytes: number; uploaded_bytes: number; is_ready: boolean;
  is_active: boolean; sort_order: number; created_at: string
}
export interface MediaLimits { max_video_bytes: number; max_image_bytes: number; chunk_bytes: number; large_upload_enabled: boolean }
export type ScheduleInput = Omit<TvScheduleEntry, 'id' | 'department_id'>

const suffix = (organizationId?: string) => organizationId ? `?organization_id=${organizationId}` : ''

export const listDepartments = (organizationId?: string) => apiGet<Department[]>(`/api/admin/departments${suffix(organizationId)}`)
export const createDepartment = (body: { name: string; sort_order?: number }, organizationId?: string) => apiPost<Department>(`/api/admin/departments${suffix(organizationId)}`, body)
export const updateDepartment = (id: string, body: Partial<Pick<Department, 'name' | 'sort_order' | 'is_active'>>, organizationId?: string) => apiPatch<Department>(`/api/admin/departments/${id}${suffix(organizationId)}`, body)
export const deleteDepartment = (id: string, organizationId?: string) => apiDelete<void>(`/api/admin/departments/${id}${suffix(organizationId)}`)
export const listSchedule = (departmentId: string, organizationId?: string) => apiGet<TvScheduleEntry[]>(`/api/admin/departments/${departmentId}/schedule${suffix(organizationId)}`)
export const createScheduleItem = (departmentId: string, body: ScheduleInput, organizationId?: string) => apiPost<TvScheduleEntry>(`/api/admin/departments/${departmentId}/schedule${suffix(organizationId)}`, body)
export const updateScheduleItem = (departmentId: string, itemId: string, body: Partial<ScheduleInput>, organizationId?: string) => apiPatch<TvScheduleEntry>(`/api/admin/departments/${departmentId}/schedule/${itemId}${suffix(organizationId)}`, body)
export const deleteScheduleItem = (departmentId: string, itemId: string, organizationId?: string) => apiDelete<void>(`/api/admin/departments/${departmentId}/schedule/${itemId}${suffix(organizationId)}`)
export interface ScheduleImportResult { departments: number; created_departments: number; schedule_items: number }
export async function importScheduleFile(file: File, organizationId?: string): Promise<ScheduleImportResult> {
  const response = await fetch(`/api/admin/departments/import${suffix(organizationId)}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    body: file,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const detail = body?.detail
    throw new ApiError(response.status, typeof detail?.code === 'string' ? detail.code : 'invalid_excel_format',
      undefined, typeof detail?.row === 'number' ? detail.row : undefined)
  }
  return response.json() as Promise<ScheduleImportResult>
}
export const getMediaLimits = (organizationId?: string) => apiGet<MediaLimits>(`/api/admin/tv-media/limits${suffix(organizationId)}`)
export const listMedia = (organizationId?: string) => apiGet<MediaAsset[]>(`/api/admin/tv-media${suffix(organizationId)}`)
export const createMedia = (body: { title: string; kind: MediaAsset['kind']; mime_type: string; size_bytes: number }, organizationId?: string) => apiPost<MediaAsset>(`/api/admin/tv-media${suffix(organizationId)}`, body)
export const createYoutubeMedia = (body: { title: string; url: string }, organizationId?: string) => apiPost<MediaAsset>(`/api/admin/tv-media/youtube${suffix(organizationId)}`, body)
export const updateMedia = (id: string, body: Partial<Pick<MediaAsset, 'title' | 'sort_order' | 'is_active'>>, organizationId?: string) => apiPatch<MediaAsset>(`/api/admin/tv-media/${id}${suffix(organizationId)}`, body)
export const deleteMedia = (id: string, organizationId?: string) => apiDelete<void>(`/api/admin/tv-media/${id}${suffix(organizationId)}`)
export const completeMedia = (id: string, organizationId?: string) => apiPost<MediaAsset>(`/api/admin/tv-media/${id}/complete${suffix(organizationId)}`)

async function sendChunk(id: string, index: number, blob: Blob, organizationId?: string): Promise<void> {
  const response = await fetch(`/api/admin/tv-media/${id}/chunks/${index}${suffix(organizationId)}`, {
    method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream' }, body: blob,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(response.status, typeof body?.detail?.code === 'string' ? body.detail.code : 'upload_failed')
  }
}

export async function uploadMediaFile(
  file: File, title: string, kind: 'advertisement', limits: MediaLimits,
  onProgress: (ratio: number) => void, organizationId?: string,
): Promise<MediaAsset> {
  const asset = await createMedia({ title, kind, mime_type: file.type, size_bytes: file.size }, organizationId)
  try {
    const count = Math.ceil(file.size / limits.chunk_bytes)
    for (let index = 0; index < count; index += 1) {
      const start = index * limits.chunk_bytes
      await sendChunk(asset.id, index, file.slice(start, start + limits.chunk_bytes), organizationId)
      onProgress((index + 1) / count)
    }
    return await completeMedia(asset.id, organizationId)
  } catch (error) {
    await deleteMedia(asset.id, organizationId).catch(() => undefined)
    throw error
  }
}
