import Directory from '../../components/Directory'
import LoadError from '../../components/LoadError'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { archiveStaff, createStaff, listStaff, restoreStaff, updateStaff } from '../../api/staffAdmin'
import type { StaffCreatePayload } from '../../api/staffAdmin'
import type { StaffUser } from '../../api/types'
import StatusBadge from '../../components/StatusBadge'
import ToastStack from '../../components/ToastStack'
import { useToasts } from '../../hooks/useToasts'
import { apiErrorMessage } from '../../lib/apiError'
import StaffFormModal from './StaffFormModal'

export default function AdminUsersPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loadError, setLoadError] = useState(false)
  const { toasts, push, dismiss } = useToasts()
  const [staff, setStaff] = useState<StaffUser[] | null>(null)
  const [editing, setEditing] = useState<StaffUser | null>(null)
  const [creating, setCreating] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)

  async function load() {
    setLoadError(false)
    try {
    setStaff(await listStaff(includeArchived))
    } catch { setLoadError(true) }
  }

  useEffect(() => {
    void load()
  }, [includeArchived])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setCreating(true)
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('new')
      return next
    }, { replace: true })
  }, [searchParams, setSearchParams])

  async function handleCreate(payload: StaffCreatePayload) {
    try {
      if (editing) {
        await updateStaff(editing.id, { email: payload.email, full_name: payload.full_name, role: payload.role, ...(payload.password ? { password: payload.password } : {}) })
        setEditing(null)
      } else await createStaff(payload)
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

  async function handleArchive(user: StaffUser) {
    if (!window.confirm(t('crud.archiveUserConfirm', { name: user.full_name }))) return
    try { await archiveStaff(user.id) }
    catch (err) { push(apiErrorMessage(err, t)) }
    finally { await load() }
  }

  async function handleRestore(user: StaffUser) {
    try { await restoreStaff(user.id); push(t('crud.restoreHint')) }
    catch (err) { push(apiErrorMessage(err, t)) }
    finally { await load() }
  }

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1>{t('admin.users.title')}</h1>
        <div className="admin-table__actions">
          <button type="button" className="admin-button--secondary" onClick={() => setIncludeArchived(!includeArchived)}>{t(includeArchived ? 'crud.hideArchived' : 'crud.showArchived')}</button>
          <button type="button" data-assistant-tour="create-user" onClick={() => setCreating(true)}>{t('admin.users.create')}</button>
        </div>
      </div>

      {staff === null ? (
        loadError ? null : <div className="spinner" aria-hidden="true" />
      ) : (
        <Directory
          items={staff}
          searchLabel={t('directory.searchUsers')}
          search={(item) => `${item.full_name} ${item.email}`}
          filters={[
            { key: 'status', label: t('directory.status'), value: (item) => item.deleted_at ? 'archived' : item.is_active ? 'active' : 'inactive', options: [
              { value: 'active', label: t('admin.users.active') }, { value: 'inactive', label: t('admin.users.inactive') },
              ...(includeArchived ? [{ value: 'archived', label: t('crud.archived') }] : []),
            ] },
            { key: 'role', label: t('admin.users.columns.role'), value: (item) => item.role, options: ['operator', 'registrar'].map((value) => ({ value, label: t(`admin.users.role.${value}`) })) },
          ]}
          sorts={[
            { key: 'name', label: t('admin.users.columns.fullName'), value: (item) => item.full_name },
            { key: 'email', label: t('admin.users.columns.email'), value: (item) => item.email },
            { key: 'role', label: t('admin.users.columns.role'), value: (item) => t(`admin.users.role.${item.role}`) },
          ]}
        >{(visible) => (
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
            {visible.map((user) => (
              <tr key={user.id}>
                <td>{user.full_name}</td>
                <td>{user.email}</td>
                <td>{t(`admin.users.role.${user.role}`)}</td>
                <td>
                  <StatusBadge
                    tone={user.is_active && !user.deleted_at ? 'success' : 'neutral'}
                    label={t(user.deleted_at ? 'crud.archived' : user.is_active ? 'admin.users.active' : 'admin.users.inactive')}
                  />
                </td>
                <td className="admin-table__actions">
                  {user.deleted_at ? <button type="button" onClick={() => void handleRestore(user)}>{t('crud.restore')}</button> : <>
                    <button type="button" onClick={() => setEditing(user)}>{t('admin.common.edit')}</button>
                    <button type="button" onClick={() => void handleToggleActive(user)}>{t(user.is_active ? 'admin.users.deactivate' : 'admin.users.activate')}</button>
                    {user.totp_enabled && <button type="button" onClick={() => void handleResetTotp(user)}>{t('admin.users.resetTotp')}</button>}
                    <button type="button" className="admin-action--danger" onClick={() => void handleArchive(user)}>{t('crud.archive')}</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}</Directory>
      )}

      {(creating || editing) && <StaffFormModal initial={editing ?? undefined} onSubmit={handleCreate} onClose={() => { setCreating(false); setEditing(null) }} />}

      {loadError && <LoadError retry={() => void load()} />}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
