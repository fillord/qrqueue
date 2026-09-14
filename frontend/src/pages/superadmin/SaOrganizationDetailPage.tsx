import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { createOrgAdmin, getOrganization, listOrgAdmins, resetOrgAdminTotp, setOrgAdminActive } from '../../api/superadmin'
import type { AdminCreatePayload } from '../../api/superadmin'
import type { Organization, StaffUser } from '../../api/types'
import StatusBadge from '../../components/StatusBadge'
import ToastStack from '../../components/ToastStack'
import { useToasts } from '../../hooks/useToasts'
import { apiErrorMessage } from '../../lib/apiError'
import AdminTvScreensPage from '../admin/AdminTvScreensPage'
import AdminFormModal from './AdminFormModal'

export default function SaOrganizationDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toasts, push, dismiss } = useToasts()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [admins, setAdmins] = useState<StaffUser[] | null>(null)
  const [creating, setCreating] = useState(false)

  async function load() {
    if (!id) return
    const [org, adminList] = await Promise.all([getOrganization(id), listOrgAdmins(id)])
    setOrganization(org)
    setAdmins(adminList)
  }

  useEffect(() => {
    load().catch(() => navigate('/sa/organizations', { replace: true }))
  }, [id, navigate])

  async function handleCreateAdmin(payload: AdminCreatePayload) {
    if (!id) return
    try {
      await createOrgAdmin(id, payload)
      setCreating(false)
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  async function handleToggleAdminActive(admin: StaffUser) {
    if (!id) return
    try {
      await setOrgAdminActive(id, admin.id, !admin.is_active)
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  async function handleResetAdminTotp(admin: StaffUser) {
    if (!id || !window.confirm(t('admin.users.resetTotpConfirm', { name: admin.full_name }))) return
    try {
      await resetOrgAdminTotp(id, admin.id)
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  if (!organization || !id) {
    return (
      <div className="admin-page">
        <div className="spinner" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="admin-page">
      <Link to="/sa/organizations" className="admin-page__back">
        {t('admin.saOrganizations.detail.back')}
      </Link>

      <div className="admin-page__header">
        <h1>{organization.name}</h1>
        <StatusBadge
          tone={organization.is_active ? 'success' : 'neutral'}
          label={t(organization.is_active ? 'admin.users.active' : 'admin.users.inactive')}
        />
      </div>
      <p className="admin-page__hint">
        <code>{organization.slug}</code> · {t(`admin.saOrganizations.plan.${organization.plan}`)}
      </p>

      <div className="admin-table__actions">
        <Link to={`/sa/analytics?organization_id=${id}`}>{t('admin.saOrganizations.detail.analytics')}</Link>
        <Link to={`/sa/audit-logs?organization_id=${id}`}>{t('admin.saOrganizations.detail.auditLogs')}</Link>
      </div>

      <section className="admin-analytics__section">
        <div className="admin-page__header">
          <h2>{t('admin.saOrganizations.detail.admins')}</h2>
          <button type="button" onClick={() => setCreating(true)}>
            {t('admin.saOrganizations.adminForm.create')}
          </button>
        </div>

        {admins === null ? (
          <div className="spinner" aria-hidden="true" />
        ) : admins.length === 0 ? (
          <p className="admin-page__empty">{t('admin.saOrganizations.detail.adminsEmpty')}</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('admin.users.columns.fullName')}</th>
                <th>{t('admin.users.columns.email')}</th>
                <th>{t('admin.users.columns.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id}>
                  <td>{admin.full_name}</td>
                  <td>{admin.email}</td>
                  <td>
                    <StatusBadge
                      tone={admin.is_active ? 'success' : 'neutral'}
                      label={t(admin.is_active ? 'admin.users.active' : 'admin.users.inactive')}
                    />
                  </td>
                  <td className="admin-table__actions">
                    <button type="button" onClick={() => void handleToggleAdminActive(admin)}>
                      {t(admin.is_active ? 'admin.users.deactivate' : 'admin.users.activate')}
                    </button>
                    {admin.totp_enabled && (
                      <button type="button" onClick={() => void handleResetAdminTotp(admin)}>
                        {t('admin.users.resetTotp')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="admin-analytics__section">
        <h2>{t('admin.nav.tvScreens')}</h2>
        <AdminTvScreensPage organizationId={id} />
      </section>

      {creating && <AdminFormModal onSubmit={handleCreateAdmin} onClose={() => setCreating(false)} />}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
