import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import QRCode from 'qrcode'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../../api/client'
import type { TotpSetup } from '../../api/types'
import { useAuth } from '../../app/AuthContext'
import { roleHome } from '../../app/roleHome'

const KNOWN_ERRORS = [
  'invalid_credentials',
  'organization_inactive',
  'rate_limited',
  'invalid_totp',
  'totp_expired',
  'unknown_error',
] as const
type LoginErrorCode = (typeof KNOWN_ERRORS)[number]

function toErrorCode(err: unknown): LoginErrorCode {
  if (err instanceof ApiError) {
    if ((KNOWN_ERRORS as readonly string[]).includes(err.code)) return err.code as LoginErrorCode
    if (err.status === 401) return 'invalid_credentials'
    if (err.status === 429) return 'rate_limited'
  }
  return 'unknown_error'
}

/** Enrollment: the authenticator app scans the otpauth QR (or the secret is
 * typed by hand); nothing is saved server-side until a code is confirmed. */
function TotpSetupBlock({ setup }: { setup: TotpSetup }) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current) void QRCode.toCanvas(canvasRef.current, setup.otpauth_uri, { width: 200, margin: 1 })
  }, [setup.otpauth_uri])

  return (
    <div className="login-form__totp-setup">
      <p>{t('login.totp.setupHint')}</p>
      <canvas ref={canvasRef} className="login-form__totp-qr" />
      <p className="login-form__totp-secret">
        <span>{t('login.totp.secret')}</span>
        <code>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
      </p>
    </div>
  )
}

export default function LoginPage() {
  const { t } = useTranslation()
  const { login, completeTotp, status, user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [totpStep, setTotpStep] = useState<{ setup: TotpSetup | null } | null>(null)
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
      const outcome = await login(email, password)
      if (outcome.kind === 'totp') {
        setTotpStep({ setup: outcome.setup })
      } else {
        navigate(roleHome(outcome.user.role), { replace: true })
      }
    } catch (err) {
      setErrorCode(toErrorCode(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleTotpSubmit(e: FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return
    setSubmitting(true)
    setErrorCode(null)
    try {
      const loggedInUser = await completeTotp(code)
      navigate(roleHome(loggedInUser.role), { replace: true })
    } catch (err) {
      const nextError = toErrorCode(err)
      setErrorCode(nextError)
      setCode('')
      if (nextError === 'totp_expired') setTotpStep(null) // back to the password step
    } finally {
      setSubmitting(false)
    }
  }

  if (totpStep) {
    return (
      <div className="login-page">
        <form className="login-form" onSubmit={(e) => void handleTotpSubmit(e)}>
          <h1 className="login-form__title">{t(totpStep.setup ? 'login.totp.setupTitle' : 'login.totp.title')}</h1>
          {totpStep.setup && <TotpSetupBlock setup={totpStep.setup} />}

          <label className="login-form__field">
            <span>{t('login.totp.code')}</span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
          </label>

          {errorCode && <p className="login-form__error">{t(`login.errors.${errorCode}`)}</p>}

          <button type="submit" disabled={submitting || code.length !== 6}>
            {submitting ? t('login.submitting') : t('login.totp.submit')}
          </button>
          <button type="button" className="login-form__link" onClick={() => { setTotpStep(null); setErrorCode(null) }}>
            {t('login.totp.back')}
          </button>
        </form>
      </div>
    )
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
