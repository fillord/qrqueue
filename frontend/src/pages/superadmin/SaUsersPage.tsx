import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { archiveManagedUser, createManagedUser, getOrganizations, listAllUsers, restoreManagedUser, updateManagedUser } from '../../api/superadmin'
import type { UserDirectoryEntry } from '../../api/superadmin'
import type { Organization } from '../../api/types'
import Directory from '../../components/Directory'
import LoadError from '../../components/LoadError'
import StatusBadge from '../../components/StatusBadge'
import ToastStack from '../../components/ToastStack'
import { useToasts } from '../../hooks/useToasts'
import { apiErrorMessage } from '../../lib/apiError'
import UserFormModal from './UserFormModal'
import type { UserFormValues } from './UserFormModal'

export default function SaUsersPage() {
  const { t, i18n } = useTranslation()
  const [users, setUsers] = useState<UserDirectoryEntry[] | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [organizationChoices, setOrganizationChoices] = useState<Organization[]>([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<UserDirectoryEntry | null>(null)
  const { toasts, push, dismiss } = useToasts()
  async function load() {
    setError(false)
    setLoading(true)
    try {
      const [userList, orgList] = await Promise.all([listAllUsers(includeArchived), getOrganizations()])
      setUsers(userList)
      setOrganizationChoices(orgList)
    }
    catch { setError(true) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [includeArchived])
  async function saveUser(values: UserFormValues) {
    try {
      if (editing) await updateManagedUser(editing.id, { email: values.email, full_name: values.full_name, role: values.role, ...(values.password ? { password: values.password } : {}) })
      else if (values.organization_id && values.password) await createManagedUser({ email: values.email, full_name: values.full_name, role: values.role, organization_id: values.organization_id, password: values.password })
      setEditing(null)
      setCreating(false)
    } catch (err) { push(apiErrorMessage(err, t)) }
    finally { await load() }
  }
  async function archiveUser(user: UserDirectoryEntry) {
    if (!window.confirm(t('crud.archiveUserConfirm', { name: user.full_name }))) return
    try { await archiveManagedUser(user.id) }
    catch (err) { push(apiErrorMessage(err, t)) }
    finally { await load() }
  }
  async function restoreUser(user: UserDirectoryEntry) {
    try { await restoreManagedUser(user.id); push(t('crud.restoreHint')) }
    catch (err) { push(apiErrorMessage(err, t)) }
    finally { await load() }
  }
  async function toggleUser(user: UserDirectoryEntry) {
    try { await updateManagedUser(user.id, { is_active: !user.is_active }) }
    catch (err) { push(apiErrorMessage(err, t)) }
    finally { await load() }
  }
  async function resetTotp(user: UserDirectoryEntry) {
    if (!window.confirm(t('admin.users.resetTotpConfirm', { name: user.full_name }))) return
    try { await updateManagedUser(user.id, { reset_totp: true }) }
    catch (err) { push(apiErrorMessage(err, t)) }
    finally { await load() }
  }
  const organizations = Array.from(new Map((users ?? []).filter((user) => user.organization_id).map((user) => [user.organization_id!, user.organization_name!])).entries())
    .sort((a, b) => a[1].localeCompare(b[1], i18n.language))
  return <div className="admin-page">
    <div className="admin-page__header"><h1>{t('directory.users')}</h1><div className="admin-table__actions">
      <button type="button" className="admin-button--secondary" onClick={() => setIncludeArchived(!includeArchived)}>{t(includeArchived ? 'crud.hideArchived' : 'crud.showArchived')}</button>
      <button type="button" className="admin-button--secondary" disabled={loading} onClick={() => void load()}>{t('admin.trials.refresh')}</button>
      <button type="button" data-assistant-tour="create-user" onClick={() => setCreating(true)}>{t('crud.createUser')}</button>
    </div></div>
    <p className="admin-page__hint">{t('directory.usersHint')}</p>
    {error && <LoadError retry={() => void load()} />}
    {!users && !error && <div className="spinner" />}
    {users && <Directory items={users} searchLabel={t('directory.searchAllUsers')}
      search={(user) => `${user.full_name} ${user.email} ${user.organization_name ?? ''}`}
      filters={[
        { key: 'status', label: t('directory.status'), value: (user) => user.deleted_at ? 'archived' : user.is_active ? 'active' : 'inactive', options: [{ value: 'active', label: t('admin.users.active') }, { value: 'inactive', label: t('admin.users.inactive') }, ...(includeArchived ? [{ value: 'archived', label: t('crud.archived') }] : [])] },
        { key: 'role', label: t('admin.users.columns.role'), value: (user) => user.role, options: ['superadmin', 'org_admin', 'operator', 'registrar'].map((value) => ({ value, label: t(`directory.roles.${value}`) })) },
        { key: 'organization', label: t('directory.organization'), value: (user) => user.organization_id ?? 'none', options: [{ value: 'none', label: t('directory.platform') }, ...organizations.map(([value, label]) => ({ value, label }))] },
      ]}
      sorts={[
        { key: 'name', label: t('admin.users.columns.fullName'), value: (user) => user.full_name },
        { key: 'email', label: t('admin.users.columns.email'), value: (user) => user.email },
        { key: 'organization', label: t('directory.organization'), value: (user) => user.organization_name ?? '' },
        { key: 'role', label: t('admin.users.columns.role'), value: (user) => t(`directory.roles.${user.role}`) },
      ]}>
      {(visible) => <table className="admin-table"><thead><tr>
        <th>{t('admin.users.columns.fullName')}</th><th>{t('admin.users.columns.email')}</th><th>{t('admin.users.columns.role')}</th><th>{t('directory.organization')}</th><th>{t('directory.status')}</th><th />
      </tr></thead><tbody>{visible.map((user) => <tr key={user.id}>
        <td>{user.full_name}</td><td>{user.email}</td><td>{t(`directory.roles.${user.role}`)}</td>
        <td>{user.organization_id ? <Link to={`/sa/organizations/${user.organization_id}`}>{user.organization_name}</Link> : t('directory.platform')}</td>
        <td><StatusBadge tone={user.is_active && !user.deleted_at ? 'success' : 'neutral'} label={t(user.deleted_at ? 'crud.archived' : user.is_active ? 'admin.users.active' : 'admin.users.inactive')} /></td>
        <td className="admin-table__actions">{user.role !== 'superadmin' && (user.deleted_at ?
          <button type="button" onClick={() => void restoreUser(user)}>{t('crud.restore')}</button> : <>
            <button type="button" onClick={() => setEditing(user)}>{t('admin.common.edit')}</button>
            <button type="button" onClick={() => void toggleUser(user)}>{t(user.is_active ? 'admin.users.deactivate' : 'admin.users.activate')}</button>
            {user.totp_enabled && <button type="button" onClick={() => void resetTotp(user)}>{t('admin.users.resetTotp')}</button>}
            <button type="button" className="admin-action--danger" onClick={() => void archiveUser(user)}>{t('crud.archive')}</button>
          </>)}</td>
      </tr>)}</tbody></table>}
    </Directory>}
    {(creating || editing) && <UserFormModal initial={editing ?? undefined} organizations={organizationChoices} onSubmit={saveUser} onClose={() => { setCreating(false); setEditing(null) }} />}
    <ToastStack toasts={toasts} onDismiss={dismiss} />
  </div>
}
