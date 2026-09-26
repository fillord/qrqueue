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
  user: ['login', 'totp_enabled', 'created', 'updated', 'deactivated', 'archived', 'restored', 'totp_recovered'],
  organization: ['created', 'updated', 'deactivated', 'archived', 'restored'],
  trial_request: ['updated'],
}

export function auditActionLabel(t: TFunction, action: string): string {
  return t(`admin.auditLog.actions.${action}`, { defaultValue: t('admin.auditLog.unknownAction') })
}

export function auditEntityLabel(t: TFunction, entityType: string): string {
  return t(`admin.auditLog.entities.${entityType}`, { defaultValue: t('admin.auditLog.unknownEntity') })
}
