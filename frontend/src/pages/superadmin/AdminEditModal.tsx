import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { StaffUser } from '../../api/types'
import Modal from '../../components/Modal'

export default function AdminEditModal({ initial, onSubmit, onClose }: {
  initial: StaffUser
  onSubmit: (payload: { email: string; full_name: string; password?: string }) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState(initial.email)
  const [name, setName] = useState(initial.full_name)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    try { await onSubmit({ email: email.trim(), full_name: name.trim(), ...(password ? { password } : {}) }) }
    finally { setSubmitting(false) }
  }
  return <Modal title={t('crud.editUser')} onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => void submit(event)}>
      <label className="modal__field"><span>{t('admin.users.form.fullName')}</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label className="modal__field"><span>{t('admin.users.form.email')}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label className="modal__field"><span>{t('admin.users.form.password')}</span><input type="password" value={password} minLength={8} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
      <p>{t('admin.common.passwordHint')}</p>
      <div className="modal__actions"><button type="button" className="modal__cancel" onClick={onClose}>{t('admin.users.form.cancel')}</button><button type="submit" disabled={!email.trim() || !name.trim() || submitting}>{t('crud.save')}</button></div>
    </form>
  </Modal>
}
