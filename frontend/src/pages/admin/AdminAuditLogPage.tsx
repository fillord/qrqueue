import LoadError from '../../components/LoadError'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getAuditLogs, getOwnOrganization } from '../../api/admin'
import type { AuditLogPage } from '../../api/types'
import AuditActionFilter from '../../components/AuditActionFilter'
import AuditEntryObject from '../../components/AuditEntryObject'
import { auditActionLabel } from '../../lib/auditLogPresentation'
import { formatDateTimeInTimezone } from '../../lib/formatDate'

const PAGE_SIZE = 25

export default function AdminAuditLogPage() {
  const { t } = useTranslation()
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState(false)
  const [timezoneName, setTimezoneName] = useState('UTC')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<AuditLogPage | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void getOwnOrganization().then((org) => setTimezoneName(org.timezone)).catch(() => setError(true))
  }, [retry])

  useEffect(() => {
    setLoading(true)
    setError(false)
    void getAuditLogs({
      from: from || undefined,
      to: to || undefined,
      action: action || undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then(setPage)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [retry, action, from, to, offset])

  return (
    <div className="admin-page">
      <h1>{t('admin.auditLog.title')}</h1>

      <div className="admin-filters">
        <AuditActionFilter value={action} onChange={(value) => {
          setAction(value)
          setOffset(0)
        }} />
        <label>
          <span>{t('admin.analytics.from')}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setOffset(0)
            }}
          />
        </label>
        <label>
          <span>{t('admin.analytics.to')}</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setOffset(0)
            }}
          />
        </label>
      </div>

      {error ? <LoadError retry={() => setRetry((n) => n + 1)} /> : loading || !page ? (
        <div className="spinner" aria-hidden="true" />
      ) : page.items.length === 0 ? (
        <p className="admin-page__empty">{t('admin.auditLog.empty')}</p>
      ) : (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('admin.auditLog.columns.time')}</th>
                <th>{t('admin.auditLog.columns.actor')}</th>
                <th>{t('admin.auditLog.columns.action')}</th>
                <th>{t('admin.auditLog.columns.entity')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTimeInTimezone(item.created_at, timezoneName)}</td>
                  <td>{item.actor_name ?? t(`admin.auditLog.actorType.${item.actor_type}`)}</td>
                  <td>{auditActionLabel(t, item.action)}</td>
                  <td><AuditEntryObject item={item} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="admin-pagination">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {t('admin.auditLog.prev')}
            </button>
            <span>
              {t('admin.auditLog.pageInfo', {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, page.total),
                total: page.total,
              })}
            </span>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= page.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t('admin.auditLog.next')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
