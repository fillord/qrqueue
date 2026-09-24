import LoadError from '../../components/LoadError'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { getOrganizations, getSaAuditLogs } from '../../api/superadmin'
import type { AuditLogPage, Organization } from '../../api/types'
import { formatDateTimeInTimezone } from '../../lib/formatDate'

const PAGE_SIZE = 25

export default function SaAuditLogPage() {
  const { t } = useTranslation()
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState(false)
  const [searchParams] = useSearchParams()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [organizationId, setOrganizationId] = useState(searchParams.get('organization_id') ?? '')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<AuditLogPage | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void getOrganizations().then(setOrganizations).catch(() => setError(true))
  }, [retry])

  useEffect(() => {
    setLoading(true)
    setError(false)
    void getSaAuditLogs({
      from: from || undefined,
      to: to || undefined,
      action: action || undefined,
      organizationId: organizationId || undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then(setPage)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [retry, action, from, to, organizationId, offset])

  const selectedOrgTimezone = organizations.find((org) => org.id === organizationId)?.timezone
  const displayTimezone = selectedOrgTimezone ?? 'UTC'

  return (
    <div className="admin-page">
      <h1>{t('admin.auditLog.title')}</h1>

      <div className="admin-filters">
        <label>
          <span>{t('admin.saAnalytics.organization')}</span>
          <select
            value={organizationId}
            onChange={(e) => {
              setOrganizationId(e.target.value)
              setOffset(0)
            }}
          >
            <option value="">{t('admin.saAnalytics.allOrganizations')}</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('admin.auditLog.action')}</span>
          <input
            type="text"
            value={action}
            placeholder="ticket.called"
            onChange={(e) => {
              setAction(e.target.value)
              setOffset(0)
            }}
          />
        </label>
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
                <th>{t('admin.saAnalytics.organization')}</th>
                <th>{t('admin.auditLog.columns.actor')}</th>
                <th>{t('admin.auditLog.columns.action')}</th>
                <th>{t('admin.auditLog.columns.entity')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTimeInTimezone(item.created_at, displayTimezone)}</td>
                  <td>{organizations.find((org) => org.id === item.organization_id)?.name ?? '—'}</td>
                  <td>{item.actor_name ?? t(`admin.auditLog.actorType.${item.actor_type}`)}</td>
                  <td>
                    <code>{item.action}</code>
                  </td>
                  <td>{item.entity_type}</td>
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
