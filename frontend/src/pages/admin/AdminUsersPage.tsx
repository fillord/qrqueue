import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createStaff, listStaff, updateStaff } from '../../api/staffAdmin'
import type { StaffCreatePayload } from '../../api/staffAdmin'
import type { StaffUser } from '../../api/types'
import StatusBadge from '../../components/StatusBadge'
import ToastStack from '../../components/ToastStack'
import { useToasts } from '../../hooks/useToasts'
import { apiErrorMessage } from '../../lib/apiError'
import StaffFormModal from './StaffFormModal'

export default function AdminUsersPage() {
  const { t } = useTranslation()
  const { toasts, push, dismiss } = useToasts()
  const [staff, setStaff] = useState<StaffUser[] | null>(null)
  const [creating, setCreating] = useState(false)

  async function load() {
    setStaff(await listStaff())
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleCreate(payload: StaffCreatePayload) {
    try {
      await createStaff(payload)
      setCreating(false)
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  async function handleToggleActive(user: StaffUser) {
    try {
      await updateStaff(user.id, { is_active: !user.is_active })
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  async function handleResetTotp(user: StaffUser) {
    if (!window.confirm(t('admin.users.resetTotpConfirm', { name: user.full_name }))) return
    try {
      await updateStaff(user.id, { reset_totp: true })
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1>{t('admin.users.title')}</h1>
        <button type="button" onClick={() => setCreating(true)}>
          {t('admin.users.create')}
        </button>
      </div>

      {staff === null ? (
        <div className="spinner" aria-hidden="true" />
      ) : staff.length === 0 ? (
        <p className="admin-page__empty">{t('admin.users.empty')}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.users.columns.fullName')}</th>
              <th>{t('admin.users.columns.email')}</th>
              <th>{t('admin.users.columns.role')}</th>
              <th>{t('admin.users.columns.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.map((user) => (
              <tr key={user.id}>
                <td>{user.full_name}</td>
                <td>{user.email}</td>
                <td>{t(`admin.users.role.${user.role}`)}</td>
                <td>
                  <StatusBadge
                    tone={user.is_active ? 'success' : 'neutral'}
                    label={t(user.is_active ? 'admin.users.active' : 'admin.users.inactive')}
                  />
                </td>
                <td className="admin-table__actions">
                  <button type="button" onClick={() => void handleToggleActive(user)}>
                    {t(user.is_active ? 'admin.users.deactivate' : 'admin.users.activate')}
                  </button>
                  {user.totp_enabled && (
                    <button type="button" onClick={() => void handleResetTotp(user)}>
                      {t('admin.users.resetTotp')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && <StaffFormModal onSubmit={handleCreate} onClose={() => setCreating(false)} />}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
