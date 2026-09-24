import { CheckCircle } from '@phosphor-icons/react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { apiPost } from '../../api/client'

type Status = 'idle' | 'submitting' | 'success' | 'error'

export default function LandingRequestForm() {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [organization, setOrganization] = useState('')
  const [contact, setContact] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (!name.trim() || contact.trim().length < 3) {
      setStatus('error')
      return
    }

    setStatus('submitting')
    try {
      await apiPost('/api/public/trial-requests', { name: name.trim(), organization: organization.trim(), contact: contact.trim() })
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="landing-cta-form__success">
        <CheckCircle size={32} weight="bold" />
        <p>{t('landing.cta.form.success')}</p>
      </div>
    )
  }

  return (
    <form className="landing-cta-form" onSubmit={handleSubmit} noValidate>
      <label className="landing-cta-form__field">
        <span>{t('landing.cta.form.name')}</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('landing.cta.form.namePlaceholder')}
          autoComplete="name"
          maxLength={120}
        />
      </label>
      <label className="landing-cta-form__field">
        <span>{t('landing.cta.form.organization')}</span>
        <input
          type="text"
          value={organization}
          onChange={(event) => setOrganization(event.target.value)}
          placeholder={t('landing.cta.form.organizationPlaceholder')}
          autoComplete="organization"
          maxLength={200}
        />
      </label>
      <label className="landing-cta-form__field">
        <span>{t('landing.cta.form.contact')}</span>
        <input
          type="text"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder={t('landing.cta.form.contactPlaceholder')}
          autoComplete="tel"
          maxLength={200}
        />
      </label>
      {status === 'error' && <p className="landing-cta-form__error">{t('landing.cta.form.error')}</p>}
      <button type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? t('landing.cta.form.submitting') : t('landing.cta.form.submit')}
      </button>
    </form>
  )
}
