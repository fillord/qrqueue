import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../../api/client'
import { useAuth } from '../../app/AuthContext'
import { roleHome } from '../../app/roleHome'

type LoginErrorCode = 'invalid_credentials' | 'totp_not_supported' | 'unknown_error'

export default function LoginPage() {
  const { t } = useTranslation()
  const { login, status, user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorCode, setErrorCode] = useState<LoginErrorCode | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (status === 'authenticated' && user) {
      navigate(roleHome(user.role), { replace: true })
    }
  }, [status, user, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setErrorCode(null)
    try {
      const loggedInUser = await login(email, password)
      navigate(roleHome(loggedInUser.role), { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_not_supported') {
        setErrorCode('totp_not_supported')
      } else if (err instanceof ApiError && err.status === 401) {
        setErrorCode('invalid_credentials')
      } else {
        setErrorCode('unknown_error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={(e) => void handleSubmit(e)}>
        <h1 className="login-form__title">{t('login.title')}</h1>

        <label className="login-form__field">
          <span>{t('login.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className="login-form__field">
          <span>{t('login.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {errorCode && <p className="login-form__error">{t(`login.errors.${errorCode}`)}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </div>
  )
}
