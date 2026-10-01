import LoadError from '../../components/LoadError'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { getOwnOrganization, updateOwnOrganization } from '../../api/admin'
import type { Organization } from '../../api/types'

const LANGUAGES: Organization['default_language'][] = ['kk', 'ru', 'en']

export default function AdminOrganizationPage() {
  const { t } = useTranslation()
  const [org, setOrg] = useState<Organization | null>(null)
  const [name, setName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [brandColor, setBrandColor] = useState('')
  const [defaultLanguage, setDefaultLanguage] = useState<Organization['default_language']>('ru')
  const [timezoneValue, setTimezoneValue] = useState('')
  const [oneTicketPerOrg, setOneTicketPerOrg] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)

  function load() {
    setError(false)
    void getOwnOrganization().then((data) => {
      setOrg(data)
      setName(data.name)
      setLogoUrl(data.logo_url ?? '')
      setBrandColor(data.brand_color ?? '')
      setDefaultLanguage(data.default_language)
      setTimezoneValue(data.timezone)
      setOneTicketPerOrg(data.one_ticket_per_org)
    }).catch(() => setError(true))
  }

  useEffect(load, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(false)
    setSaved(false)
    try {
      const updated = await updateOwnOrganization({
        name,
        logo_url: logoUrl || null,
        brand_color: brandColor || null,
        default_language: defaultLanguage,
        timezone: timezoneValue,
        one_ticket_per_org: oneTicketPerOrg,
      })
      setOrg(updated)
      setSaved(true)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  if (!org) {
    return (
      <div className="admin-page">
        {error ? <LoadError retry={load} /> : <div className="spinner" aria-hidden="true" />}
      </div>
    )
  }

  return (
    <div className="admin-page admin-organization">
      <h1>{t('admin.organization.title')}</h1>

      <form className="admin-organization__form" data-assistant-tour="organization-settings" onSubmit={(e) => void handleSubmit(e)}>
        <label>
          <span>{t('admin.organization.name')}</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <label>
          <span>{t('admin.organization.logoUrl')}</span>
          <input type="text" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
        </label>

        <label>
          <span>{t('admin.organization.brandColor')}</span>
          <input
            type="text"
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            placeholder="#2563eb"
          />
        </label>

        <label>
          <span>{t('admin.organization.defaultLanguage')}</span>
          <select
            value={defaultLanguage}
            onChange={(e) => setDefaultLanguage(e.target.value as Organization['default_language'])}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {t(`language.${lang}`)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('admin.organization.timezone')}</span>
          <input type="text" value={timezoneValue} onChange={(e) => setTimezoneValue(e.target.value)} />
        </label>

        <label className="admin-organization__checkbox">
          <input
            type="checkbox"
            checked={oneTicketPerOrg}
            onChange={(e) => setOneTicketPerOrg(e.target.checked)}
          />
          <span>{t('admin.organization.oneTicketPerOrg')}</span>
        </label>

        <div className="admin-organization__actions">
          <button type="submit" disabled={saving}>
            {t('admin.organization.save')}
          </button>
          {saved && <span className="admin-organization__saved">{t('admin.organization.saved')}</span>}
          {error && <span className="admin-organization__error">{t('admin.organization.error')}</span>}
        </div>
      </form>
    </div>
  )
}
