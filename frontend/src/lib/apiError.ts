import type { TFunction } from 'i18next'

import { ApiError } from '../api/client'

export function apiErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    if (err.code === 'active_tickets') return t('crud.activeTickets')
    if (err.code === 'attached_cabinets') return t('crud.attachedCabinets')
    if (err.code === 'archived_queue') return t('crud.archivedQueue')
    if (err.code === 'department_exists') return t('signage.departmentExists')
    if (err.code === 'department_has_employees') return t('signage.departmentHasEmployees')
    if (err.code === 'media_too_large' || err.code === 'media_chunk_too_large') return t('signage.fileTooLarge')
    if (err.code === 'invalid_youtube_url') return t('signage.invalidYoutubeUrl')
    if (err.code === 'invalid_media_format' || err.code === 'invalid_media_kind') return t('signage.badFormat')
    if (err.code === 'upload_incomplete' || err.code === 'invalid_chunk_size') return t('signage.uploadIncomplete')
    if (err.code === 'excel_too_large') return t('signage.excelTooLarge')
    if (err.code === 'invalid_excel_format' || err.code === 'invalid_excel_headers') return t('signage.invalidExcelFormat')
    if (err.code === 'excel_too_many_rows') return t('signage.excelTooManyRows')
    if (err.code === 'empty_schedule_file') return t('signage.emptyExcel')
    if (err.code === 'invalid_schedule_row' || err.code === 'duplicate_schedule_row') return t('signage.invalidExcelRow', { row: err.row ?? '?' })
    if (err.status === 404) return t('admin.errors.notFound')
    if (err.status === 409) return t('admin.errors.conflict')
    if (err.status === 422) return t('admin.errors.invalid')
  }
  return t('admin.errors.unknown')
}
