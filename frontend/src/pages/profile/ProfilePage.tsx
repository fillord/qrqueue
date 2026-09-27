import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { deleteMyPhoto, updateMyEmail, updateMyName, updateMyPassword, uploadMyPhoto } from '../../api/auth'
import { ApiError } from '../../api/client'
import { useAuth } from '../../app/AuthContext'
import { roleHome } from '../../app/roleHome'
import './profile.css'

const MAX_PHOTO_BYTES = 2 * 1024 * 1024

export default function ProfilePage() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [email, setEmail] = useState(user?.email ?? '')
  const [emailPassword, setEmailPassword] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { setFullName(user?.full_name ?? '') }, [user?.full_name])
  useEffect(() => { setEmail(user?.email ?? '') }, [user?.email])

  if (!user) return null

  function showError(cause: unknown) {
    if (cause instanceof ApiError) {
      const key = `profile.errors.${cause.code}`
      setError(t(key, { defaultValue: t('profile.errors.generic') }))
    } else setError(t('profile.errors.generic'))
    setNotice('')
  }

  async function saveName(event: React.FormEvent) {
    event.preventDefault()
    setPending('name'); setError(''); setNotice('')
    try {
      await updateMyName(fullName.trim())
      await refreshUser()
      setNotice(t('profile.nameSaved'))
    } catch (cause) { showError(cause) }
    finally { setPending(null) }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault()
    if (newPassword !== confirmPassword) { setError(t('profile.errors.passwordMismatch')); return }
    setPending('password'); setError(''); setNotice('')
    try {
      await updateMyPassword(currentPassword, newPassword)
      await refreshUser()
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      setNotice(t('profile.passwordSaved'))
    } catch (cause) { showError(cause) }
    finally { setPending(null) }
  }

  async function saveEmail(event: React.FormEvent) {
    event.preventDefault()
    setPending('email'); setError(''); setNotice('')
    try {
      await updateMyEmail(email.trim(), emailPassword)
      await refreshUser()
      setEmailPassword('')
      setNotice(t('profile.emailSaved'))
    } catch (cause) { showError(cause) }
    finally { setPending(null) }
  }

  async function uploadPhoto(file: File | undefined) {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(t('profile.errors.invalid_photo_type')); return
    }
    if (file.size > MAX_PHOTO_BYTES) { setError(t('profile.errors.photo_too_large')); return }
    setPending('photo'); setError(''); setNotice('')
    try {
      await uploadMyPhoto(file)
      await refreshUser()
      setNotice(t('profile.photoSaved'))
    } catch (cause) { showError(cause) }
    finally { setPending(null) }
  }

  async function removePhoto() {
    setPending('photo'); setError(''); setNotice('')
    try {
      await deleteMyPhoto()
      await refreshUser()
      setNotice(t('profile.photoRemoved'))
    } catch (cause) { showError(cause) }
    finally { setPending(null) }
  }

  return <div className="profile-page">
    <Link className="profile-page__back" to={roleHome(user.role)}>{t('profile.back')}</Link>
    <header className="profile-page__header">
      <div className="profile-page__portrait" aria-hidden="true">
        {user.has_photo ? <img src={`/api/auth/me/photo?v=${user.photo_revision}`} alt="" /> : user.full_name.trim().slice(0, 1).toLocaleUpperCase()}
      </div>
      <div className="profile-page__identity">
        <h1>{t('profile.title')}</h1>
        <strong>{user.full_name}</strong>
        <span>{t(`directory.roles.${user.role}`)} · {user.email}</span>
      </div>
    </header>

    {(notice || error) && <div className={`profile-page__message${error ? ' profile-page__message--error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

    <div className="profile-page__grid">
      <section className="profile-card">
        <div className="profile-card__heading"><h2>{t('profile.personal')}</h2><p>{t('profile.personalHint')}</p></div>
        <div className="profile-card__photo-row">
          <div className="profile-card__mini-avatar" aria-hidden="true">
            {user.has_photo ? <img src={`/api/auth/me/photo?v=${user.photo_revision}`} alt="" /> : user.full_name.trim().slice(0, 1).toLocaleUpperCase()}
          </div>
          <div className="profile-card__photo-actions">
            <label className="profile-card__file-button">
              {t('profile.photoChoose')}
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={pending !== null} onChange={(event) => {
                void uploadPhoto(event.target.files?.[0]); event.target.value = ''
              }} />
            </label>
            {user.has_photo && <button type="button" className="profile-card__text-button" disabled={pending !== null} onClick={() => void removePhoto()}>{t('profile.photoRemove')}</button>}
            <small>{t('profile.photoHint')}</small>
          </div>
        </div>
        <form onSubmit={(event) => void saveName(event)}>
          <label className="profile-card__field"><span>{t('profile.fullName')}</span>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} maxLength={120} required autoComplete="name" />
          </label>
          <button className="profile-card__submit" type="submit" disabled={pending !== null || fullName.trim() === user.full_name}>{t('profile.saveName')}</button>
        </form>
      </section>

      <section className="profile-card">
        <div className="profile-card__heading"><h2>{t('profile.security')}</h2><p>{t('profile.securityHint')}</p></div>
        <form onSubmit={(event) => void savePassword(event)}>
          <label className="profile-card__field"><span>{t('profile.currentPassword')}</span>
            <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" />
          </label>
          <label className="profile-card__field"><span>{t('profile.newPassword')}</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={128} required autoComplete="new-password" />
          </label>
          <label className="profile-card__field"><span>{t('profile.confirmPassword')}</span>
            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={128} required autoComplete="new-password" />
          </label>
          <button className="profile-card__submit" type="submit" disabled={pending !== null}>{t('profile.savePassword')}</button>
        </form>
      </section>

      <section className="profile-card profile-card--email">
        <div className="profile-card__heading"><h2>{t('profile.emailTitle')}</h2><p>{t('profile.emailHint')}</p></div>
        {user.role === 'superadmin' ? <form onSubmit={(event) => void saveEmail(event)}>
          <label className="profile-card__field"><span>{t('profile.email')}</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </label>
          <label className="profile-card__field"><span>{t('profile.currentPassword')}</span>
            <input type="password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} required autoComplete="current-password" />
          </label>
          <button className="profile-card__submit" type="submit" disabled={pending !== null || email.trim().toLowerCase() === user.email.toLowerCase()}>{t('profile.saveEmail')}</button>
        </form> : <div className="profile-card__managed-email">
          <strong>{user.email}</strong>
          <p>{t(user.role === 'org_admin' ? 'profile.emailManagedBySuperadmin' : 'profile.emailManagedByOrgAdmin')}</p>
        </div>}
      </section>
    </div>
  </div>
}
