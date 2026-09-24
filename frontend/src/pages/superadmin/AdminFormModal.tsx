import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminCreatePayload } from '../../api/superadmin'
import Modal from '../../components/Modal'

export default function AdminFormModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (payload: AdminCreatePayload) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = email.trim() !== '' && password.length >= 8 && fullName.trim() !== ''

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({ email: email.trim(), password, full_name: fullName.trim() })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={t('admin.saOrganizations.adminForm.title')} onClose={onClose}>
      <form className="modal-form" onSubmit={(e) => void handleSubmit(e)}>
        <label className="modal__field">
          <span>{t('admin.users.form.fullName')}</span>
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>

        <label className="modal__field">
          <span>{t('admin.users.form.email')}</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label className="modal__field">
          <span>{t('admin.users.form.password')}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>

        <div className="modal__actions">
          <button type="button" className="modal__cancel" onClick={onClose}>
            {t('admin.users.form.cancel')}
          </button>
          <button type="submit" disabled={!canSubmit || submitting}>
            {t('admin.users.form.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
