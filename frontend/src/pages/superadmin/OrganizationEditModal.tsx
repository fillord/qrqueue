import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { OrganizationEditPayload } from '../../api/superadmin'
import type { Organization } from '../../api/types'
import Modal from '../../components/Modal'

function toLocalDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export default function OrganizationEditModal({ initial, onSubmit, onClose }: {
  initial: Organization;
  onSubmit: (payload: OrganizationEditPayload) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial.name)
  const [slug, setSlug] = useState(initial.slug)
  const [plan, setPlan] = useState(initial.plan)
  const [timezone, setTimezone] = useState(initial.timezone)
  const [language, setLanguage] = useState(initial.default_language)
  const [logoUrl, setLogoUrl] = useState(initial.logo_url ?? '')
  const [brandColor, setBrandColor] = useState(initial.brand_color ?? '')
  const [oneTicketPerOrg, setOneTicketPerOrg] = useState(initial.one_ticket_per_org)
  const [largeVideoUploads, setLargeVideoUploads] = useState(initial.video_large_upload_enabled)
  const [trialEndsAt, setTrialEndsAt] = useState(toLocalDateTime(initial.trial_ends_at))
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await onSubmit({ name: name.trim(), slug: slug.trim(), plan, timezone: timezone.trim(),
        default_language: language, logo_url: logoUrl.trim() || null,
        brand_color: brandColor.trim() || null, one_ticket_per_org: oneTicketPerOrg,
        video_large_upload_enabled: largeVideoUploads,
        trial_ends_at: trialEndsAt ? new Date(trialEndsAt).toISOString() : null })
    } finally { setSubmitting(false) }
  }

  return <Modal title={t('crud.editOrganization')} onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => void submit(event)}>
      <label className="modal__field"><span>{t('admin.saOrganizations.form.name')}</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label className="modal__field"><span>{t('admin.saOrganizations.form.slug')}</span>
        <input value={slug} onChange={(event) => setSlug(event.target.value)} required /></label>
      <label className="modal__field"><span>{t('admin.saOrganizations.columns.plan')}</span>
        <select value={plan} onChange={(event) => setPlan(event.target.value as Organization['plan'])}>
          {(['trial', 'basic', 'pro'] as const).map((value) => <option key={value} value={value}>{t(`admin.saOrganizations.plan.${value}`)}</option>)}
        </select></label>
      <label className="modal__field"><span>{t('admin.organization.timezone')}</span>
        <input value={timezone} onChange={(event) => setTimezone(event.target.value)} required /></label>
      <label className="modal__field"><span>{t('crud.trialEndsAt')}</span>
        <input type="datetime-local" value={trialEndsAt} onChange={(event) => setTrialEndsAt(event.target.value)} /></label>
      <label className="modal__field"><span>{t('admin.organization.defaultLanguage')}</span>
        <select value={language} onChange={(event) => setLanguage(event.target.value as Organization['default_language'])}>
          {(['kk', 'ru', 'en'] as const).map((value) => <option key={value} value={value}>{t(`language.${value}`)}</option>)}
        </select></label>
      <label className="modal__field"><span>{t('admin.organization.logoUrl')}</span>
        <input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} /></label>
      <label className="modal__field"><span>{t('admin.organization.brandColor')}</span>
        <input value={brandColor} onChange={(event) => setBrandColor(event.target.value)} placeholder="#2563eb" /></label>
      <label className="modal__field modal__field--checkbox"><input type="checkbox" checked={oneTicketPerOrg} onChange={(event) => setOneTicketPerOrg(event.target.checked)} />
        <span>{t('admin.organization.oneTicketPerOrg')}</span></label>
      <label className="modal__field modal__field--checkbox"><input type="checkbox" checked={largeVideoUploads} onChange={(event) => setLargeVideoUploads(event.target.checked)} />
        <span>{t('signage.largeVideoUploads')}</span></label>
      <div className="modal__actions"><button type="button" className="modal__cancel" onClick={onClose}>{t('admin.users.form.cancel')}</button>
        <button type="submit" disabled={!name.trim() || !slug.trim() || !timezone.trim() || submitting}>{t('crud.save')}</button></div>
    </form>
  </Modal>
}
