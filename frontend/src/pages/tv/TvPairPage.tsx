import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { pairDevice } from '../../api/tv'
import { getRememberedDeviceToken, rememberDeviceToken } from '../../lib/tvDevice'

/**
 * /tv/pair — fullscreen dark pairing screen. A device_token already saved
 * in localStorage skips straight to /tv; otherwise the operator types the
 * 6-digit code shown on the TV itself (ARCHITECTURE.md section 2, tv_screens
 * .pairing_code) here.
 */
export default function TvPairPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (getRememberedDeviceToken()) {
      navigate('/tv', { replace: true })
    }
  }, [navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return
    setSubmitting(true)
    setError(false)
    try {
      const { device_token: deviceToken } = await pairDevice(code)
      rememberDeviceToken(deviceToken)
      navigate('/tv', { replace: true })
    } catch {
      setError(true)
      setCode('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="tv-pair">
      <form className="tv-pair__form" onSubmit={(e) => void handleSubmit(e)}>
        <h1 className="tv-pair__title">{t('tv.pair.title')}</h1>
        <p className="tv-pair__hint">{t('tv.pair.hint')}</p>
        <input
          className="tv-pair__input"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        {error && <p className="tv-pair__error">{t('tv.pair.error')}</p>}
        <button type="submit" disabled={submitting || code.length !== 6}>
          {submitting ? t('tv.pair.submitting') : t('tv.pair.submit')}
        </button>
      </form>
    </div>
  )
}
