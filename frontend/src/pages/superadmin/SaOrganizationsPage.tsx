import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { createOrganization, getOrganizations, setOrganizationActive } from '../../api/superadmin'
import type { OrganizationCreatePayload } from '../../api/superadmin'
import type { Organization } from '../../api/types'
import StatusBadge from '../../components/StatusBadge'
import ToastStack from '../../components/ToastStack'
import { useToasts } from '../../hooks/useToasts'
import { apiErrorMessage } from '../../lib/apiError'
import OrganizationFormModal from './OrganizationFormModal'

export default function SaOrganizationsPage() {
  const { t } = useTranslation()
  const { toasts, push, dismiss } = useToasts()
  const [organizations, setOrganizations] = useState<Organization[] | null>(null)
  const [creating, setCreating] = useState(false)

  async function load() {
    setOrganizations(await getOrganizations())
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleCreate(payload: OrganizationCreatePayload) {
    try {
      await createOrganization(payload)
      setCreating(false)
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  async function handleToggleActive(org: Organization) {
    try {
      await setOrganizationActive(org.id, !org.is_active)
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1>{t('admin.saOrganizations.title')}</h1>
        <button type="button" onClick={() => setCreating(true)}>
          {t('admin.saOrganizations.create')}
        </button>
      </div>

      {organizations === null ? (
        <div className="spinner" aria-hidden="true" />
      ) : organizations.length === 0 ? (
        <p className="admin-page__empty">{t('admin.saOrganizations.empty')}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.saOrganizations.columns.name')}</th>
              <th>{t('admin.saOrganizations.columns.slug')}</th>
              <th>{t('admin.saOrganizations.columns.plan')}</th>
              <th>{t('admin.saOrganizations.columns.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {organizations.map((org) => (
              <tr key={org.id}>
                <td>
                  <Link to={`/sa/organizations/${org.id}`}>{org.name}</Link>
                </td>
                <td>
                  <code>{org.slug}</code>
                </td>
                <td>{t(`admin.saOrganizations.plan.${org.plan}`)}</td>
                <td>
                  <StatusBadge
                    tone={org.is_active ? 'success' : 'neutral'}
                    label={t(org.is_active ? 'admin.users.active' : 'admin.users.inactive')}
                  />
                </td>
                <td className="admin-table__actions">
                  <button type="button" onClick={() => void handleToggleActive(org)}>
                    {t(org.is_active ? 'admin.users.deactivate' : 'admin.users.activate')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && <OrganizationFormModal onSubmit={handleCreate} onClose={() => setCreating(false)} />}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
