import { useTranslation } from 'react-i18next'

import type { AuditLogItem } from '../api/types'
import { auditEntityLabel } from '../lib/auditLogPresentation'

const VISIBLE_FIELDS = [
  'name', 'full_name', 'email', 'role', 'label', 'title', 'status', 'is_active',
  'processed', 'source', 'call_count', 'rating', 'reason', 'timezone',
  'default_language', 'plan', 'trial_ends_at', 'one_ticket_per_org',
  'video_large_upload_enabled', 'ticket_prefix', 'geo_radius_m',
  'presence_timeout_min', 'daily_ticket_limit', 'slide_seconds', 'ads_enabled',
  'media_playlist_mode', 'queue_selection_mode', 'cabinet_selection_mode',
  'doctor_name', 'service_name', 'room', 'weekday', 'starts_at', 'ends_at',
  'departments', 'created_departments', 'schedule_items', 'sort_order',
  'selected_media_ids', 'selected_queue_ids', 'selected_cabinet_ids',
  'schedule', 'fields', 'password', 'reset_totp',
] as const

function AuditValue({ field, value }: { field: string; value: unknown }) {
  const { t } = useTranslation()
  if (field === 'password') return <>{t('admin.auditLog.valueChanged')}</>
  if (value === null) return <>{t('admin.auditLog.noValue')}</>
  if (typeof value === 'boolean') return <>{t(value ? 'admin.auditLog.yes' : 'admin.auditLog.no')}</>
  if (Array.isArray(value)) {
    if (field === 'fields') return <>{value.map((key) => t(`admin.auditLog.fields.${key}`, { defaultValue: String(key) })).join(', ')}</>
    return <>{t('admin.auditLog.itemsCount', { count: value.length })}</>
  }
  if (typeof value === 'string') {
    if (['role', 'status', 'source', 'plan', 'media_playlist_mode', 'queue_selection_mode', 'cabinet_selection_mode'].includes(field)) {
      return <>{t(`admin.auditLog.values.${value}`, { defaultValue: value })}</>
    }
    return <>{value}</>
  }
  if (typeof value === 'number') {
    if (field === 'weekday' && value >= 0 && value <= 6) {
      const day = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][value]
      return <>{t(`admin.analytics.weekdays.${day}`)}</>
    }
    return <>{value}</>
  }
  return <>{t('admin.auditLog.noValue')}</>
}

export default function AuditEntryObject({ item }: { item: AuditLogItem }) {
  const { t } = useTranslation()
  const fields = VISIBLE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(item.payload, field))
  return (
    <div className="audit-object">
      <strong>{auditEntityLabel(t, item.entity_type)}{item.entity_label ? ` ${item.entity_label}` : ''}</strong>
      {(item.queue_name || item.cabinet_label) && <small className="audit-object__context">
        {[item.queue_name && `${t('admin.auditLog.queue')}: ${item.queue_name}`,
          item.cabinet_label && `${t('admin.auditLog.cabinet')}: ${item.cabinet_label}`].filter(Boolean).join(' · ')}
      </small>}
      {fields.length > 0 && <details className="audit-object__details">
        <summary>{t('admin.auditLog.details')}</summary>
        <dl>{fields.map((field) => <div key={field}>
          <dt>{t(`admin.auditLog.fields.${field}`)}</dt>
          <dd><AuditValue field={field} value={item.payload[field]} /></dd>
        </div>)}</dl>
      </details>}
    </div>
  )
}
