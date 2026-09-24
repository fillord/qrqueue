import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { ManagedUserRole, UserDirectoryEntry } from '../../api/superadmin'
import type { Organization } from '../../api/types'
import Modal from '../../components/Modal'

export interface UserFormValues {
  email: string
  full_name: string
  password?: string
  role: ManagedUserRole
  organization_id?: string
}

export default function UserFormModal({ initial, organizations, onSubmit, onClose }: {
  initial?: UserDirectoryEntry
  organizations: Organization[]
  onSubmit: (values: UserFormValues) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState(initial?.email ?? '')
  const [fullName, setFullName] = useState(initial?.full_name ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<ManagedUserRole>(initial?.role === 'org_admin' || initial?.role === 'registrar' ? initial.role : 'operator')
  const [organizationId, setOrganizationId] = useState(initial?.organization_id ?? '')
  const [submitting, setSubmitting] = useState(false)
  const valid = email.trim() && fullName.trim() && (initial || password.length >= 8) && (initial || organizationId)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid) return
    setSubmitting(true)
    try {
      await onSubmit({ email: email.trim(), full_name: fullName.trim(),
        ...(password ? { password } : {}), role,
        ...(!initial ? { organization_id: organizationId } : {}) })
    } finally { setSubmitting(false) }
  }

  return <Modal title={t(initial ? 'crud.editUser' : 'crud.createUser')} onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => void submit(event)}>
      <label className="modal__field"><span>{t('admin.users.form.fullName')}</span>
        <input value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>
      <label className="modal__field"><span>{t('admin.users.form.email')}</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label className="modal__field"><span>{t('admin.users.form.password')}</span>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required={!initial} autoComplete="new-password" /></label>
      {initial && <p>{t('admin.common.passwordHint')}</p>}
      {!initial && <label className="modal__field"><span>{t('directory.organization')}</span>
        <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required>
          <option value="">{t('crud.selectOrganization')}</option>
          {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select></label>}
      <label className="modal__field"><span>{t('admin.users.columns.role')}</span>
        <select value={role} onChange={(event) => setRole(event.target.value as ManagedUserRole)}>
          {(['org_admin', 'operator', 'registrar'] as const).map((value) => <option key={value} value={value}>{t(`directory.roles.${value}`)}</option>)}
        </select></label>
      <div className="modal__actions"><button type="button" className="modal__cancel" onClick={onClose}>{t('admin.users.form.cancel')}</button>
        <button type="submit" disabled={!valid || submitting}>{t('crud.save')}</button></div>
    </form>
  </Modal>
}
