import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { OrganizationCreatePayload } from '../../api/superadmin'
import Modal from '../../components/Modal'

export default function OrganizationFormModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (payload: OrganizationCreatePayload) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim() !== ''

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({ name: name.trim(), slug: slug.trim() || undefined })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={t('admin.saOrganizations.form.title')} onClose={onClose}>
      <form className="modal-form" onSubmit={(e) => void handleSubmit(e)}>
        <label className="modal__field">
          <span>{t('admin.saOrganizations.form.name')}</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <label className="modal__field">
          <span>{t('admin.saOrganizations.form.slug')}</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t('admin.saOrganizations.form.slugPlaceholder')}
          />
        </label>

        <div className="modal__actions">
          <button type="button" className="modal__cancel" onClick={onClose}>
            {t('admin.saOrganizations.form.cancel')}
          </button>
          <button type="submit" disabled={!canSubmit || submitting}>
            {t('admin.saOrganizations.form.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
