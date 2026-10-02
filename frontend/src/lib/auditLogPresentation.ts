import type { TFunction } from 'i18next'

// These are the stable values stored in the audit trail and accepted by the API filter.
// The UI only displays their translated labels.
export const AUDIT_ACTIONS: Record<string, readonly string[]> = {
  ticket: ['created', 'called', 'recalled', 'confirmed', 'no_show', 'returned', 'serving_started', 'finished', 'transferred', 'left', 'rated'],
  queue: ['created', 'updated', 'schedule_updated', 'archived', 'restored', 'auto_opened', 'auto_closed'],
  cabinet: ['created', 'updated', 'deactivated', 'archived', 'restored', 'operator_assigned', 'operator_unassigned', 'paused', 'resumed'],
  department: ['created', 'updated', 'deleted', 'schedule_imported', 'schedule_created', 'schedule_updated', 'schedule_deleted'],
  tv_screen: ['created', 'updated', 'unpaired', 'deleted'],
  tv_media: ['upload_started', 'upload_completed', 'updated', 'deleted'],
  user: ['login', 'totp_enabled', 'created', 'updated', 'deactivated', 'archived', 'restored', 'totp_recovered', 'profile_updated', 'password_changed', 'email_changed', 'photo_updated', 'photo_removed'],
  organization: ['created', 'updated', 'deactivated', 'archived', 'restored'],
  trial_request: ['updated'],
  attendance: ['employee_created', 'employee_updated', 'employee_archived', 'employees_imported', 'schedule_updated', 'code_reset', 'face_enrolled', 'face_submitted', 'face_approved', 'face_rejected', 'face_removed', 'settings_updated', 'enrollment_qr_rotated', 'marked_in', 'marked_out', 'manual_mark', 'event_corrected', 'kiosk_created', 'kiosk_paired', 'kiosk_unpaired', 'kiosk_archived'],
}

export function auditActionLabel(t: TFunction, action: string): string {
  return t(`admin.auditLog.actions.${action}`, { defaultValue: t('admin.auditLog.unknownAction') })
}

export function auditEntityLabel(t: TFunction, entityType: string): string {
  return t(`admin.auditLog.entities.${entityType}`, { defaultValue: t('admin.auditLog.unknownEntity') })
}
