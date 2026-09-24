import Directory from '../../components/Directory'
import LoadError from '../../components/LoadError'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { archiveOrganization, createOrganization, getOrganizations, restoreOrganization, setOrganizationActive, updateOrganization } from '../../api/superadmin'
import type { OrganizationCreatePayload, OrganizationEditPayload } from '../../api/superadmin'
import type { Organization } from '../../api/types'
import StatusBadge from '../../components/StatusBadge'
import ToastStack from '../../components/ToastStack'
import { useToasts } from '../../hooks/useToasts'
import { apiErrorMessage } from '../../lib/apiError'
import OrganizationFormModal from './OrganizationFormModal'
import OrganizationEditModal from './OrganizationEditModal'

export default function SaOrganizationsPage() {
  const { t } = useTranslation()
  const [loadError, setLoadError] = useState(false)
  const { toasts, push, dismiss } = useToasts()
  const [organizations, setOrganizations] = useState<Organization[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Organization | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)

  async function load() {
    setLoadError(false)
    try {
    setOrganizations(await getOrganizations(includeArchived))
    } catch { setLoadError(true) }
  }

  useEffect(() => {
    void load()
  }, [includeArchived])

  async function handleEdit(payload: OrganizationEditPayload) {
    if (!editing) return
    try { await updateOrganization(editing.id, payload); setEditing(null) }
    catch (err) { push(apiErrorMessage(err, t)) }
    finally { await load() }
  }

  async function handleArchive(org: Organization) {
    if (!window.confirm(t('crud.archiveOrganizationConfirm', { name: org.name }))) return
    try { await archiveOrganization(org.id) }
    catch (err) { push(apiErrorMessage(err, t)) }
    finally { await load() }
  }

  async function handleRestore(org: Organization) {
    try { await restoreOrganization(org.id); push(t('crud.restoreHint')) }
    catch (err) { push(apiErrorMessage(err, t)) }
    finally { await load() }
  }

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
        <div className="admin-table__actions">
          <button type="button" className="admin-button--secondary" onClick={() => setIncludeArchived(!includeArchived)}>{t(includeArchived ? 'crud.hideArchived' : 'crud.showArchived')}</button>
          <button type="button" onClick={() => setCreating(true)}>{t('admin.saOrganizations.create')}</button>
        </div>
      </div>

      {organizations === null ? (
        loadError ? null : <div className="spinner" aria-hidden="true" />
      ) : (
        <Directory
          items={organizations}
          searchLabel={t('directory.searchOrganizations')}
          search={(item) => `${item.name} ${item.slug}`}
          filters={[
            { key: 'status', label: t('directory.status'), value: (item) => item.deleted_at ? 'archived' : item.is_active ? 'active' : 'inactive', options: [
              { value: 'active', label: t('admin.users.active') }, { value: 'inactive', label: t('admin.users.inactive') },
              ...(includeArchived ? [{ value: 'archived', label: t('crud.archived') }] : []),
            ] },
            { key: 'plan', label: t('admin.saOrganizations.columns.plan'), value: (item) => item.plan, options: ['trial', 'basic', 'pro'].map((value) => ({ value, label: t(`admin.saOrganizations.plan.${value}`) })) },
          ]}
          sorts={[
            { key: 'name', label: t('admin.saOrganizations.columns.name'), value: (item) => item.name },
            { key: 'slug', label: t('admin.saOrganizations.columns.slug'), value: (item) => item.slug },
            { key: 'plan', label: t('admin.saOrganizations.columns.plan'), value: (item) => t(`admin.saOrganizations.plan.${item.plan}`) },
          ]}
        >{(visible) => (
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
            {visible.map((org) => (
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
                    tone={org.is_active && !org.deleted_at ? 'success' : 'neutral'}
                    label={t(org.deleted_at ? 'crud.archived' : org.is_active ? 'admin.users.active' : 'admin.users.inactive')}
                  />
                </td>
                <td className="admin-table__actions">
                  {org.deleted_at ? <button type="button" onClick={() => void handleRestore(org)}>{t('crud.restore')}</button> : <>
                    <button type="button" onClick={() => setEditing(org)}>{t('admin.common.edit')}</button>
                    <button type="button" onClick={() => void handleToggleActive(org)}>{t(org.is_active ? 'admin.users.deactivate' : 'admin.users.activate')}</button>
                    <button type="button" className="admin-action--danger" onClick={() => void handleArchive(org)}>{t('crud.archive')}</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}</Directory>
      )}

      {creating && <OrganizationFormModal onSubmit={handleCreate} onClose={() => setCreating(false)} />}
      {editing && <OrganizationEditModal initial={editing} onSubmit={handleEdit} onClose={() => setEditing(null)} />}

      {loadError && <LoadError retry={() => void load()} />}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
