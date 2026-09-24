import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { StaffCreatePayload } from '../../api/staffAdmin'
import type { StaffUser } from '../../api/types'
import Modal from '../../components/Modal'

export default function StaffFormModal({
  initial,
  onSubmit,
  onClose,
}: {
  initial?: StaffUser
  onSubmit: (payload: StaffCreatePayload) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState(initial?.email ?? '')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState(initial?.full_name ?? '')
  const [role, setRole] = useState<'operator' | 'registrar'>(initial?.role === 'registrar' ? 'registrar' : 'operator')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = email.trim() !== '' && (!!initial || password.length >= 8) && fullName.trim() !== ''

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({ email: email.trim(), password, full_name: fullName.trim(), role })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={t(initial ? 'admin.common.edit' : 'admin.users.form.title')} onClose={onClose}>
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
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!initial} minLength={8} autoComplete="new-password" />
        </label>

        {initial && <p>{t('admin.common.passwordHint')}</p>}
        <div className="modal__field">
          <span>{t('admin.users.form.role')}</span>
          <label className="modal__radio">
            <input
              type="radio"
              name="staff-role"
              checked={role === 'operator'}
              onChange={() => setRole('operator')}
            />
            <span>{t('admin.users.role.operator')}</span>
          </label>
          <label className="modal__radio">
            <input
              type="radio"
              name="staff-role"
              checked={role === 'registrar'}
              onChange={() => setRole('registrar')}
            />
            <span>{t('admin.users.role.registrar')}</span>
          </label>
        </div>

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
