import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getVapidPublicKey, subscribePush } from '../api/push'
import { isPushSupported, registerServiceWorker, subscribeToPush } from '../lib/push'

/**
 * Shown on /t/:id while notification permission hasn't been decided yet.
 * Any failure along the way (unsupported browser, denied prompt, no VAPID
 * key configured server-side, network hiccup) just hides the banner —
 * never breaks the ticket page itself.
 */
export default function PushOptInBanner() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isPushSupported()) return
    if (Notification.permission === 'default') setVisible(true)
  }, [])

  async function handleEnable() {
    setBusy(true)
    try {
      const { public_key: publicKey } = await getVapidPublicKey()
      if (!publicKey) return

      const registration = await registerServiceWorker()
      if (!registration) return

      const subscription = await subscribeToPush(registration, publicKey)
      if (subscription) await subscribePush(subscription)
    } catch {
      // denied, unsupported quirk, network hiccup — just hide, nothing breaks
    } finally {
      setBusy(false)
      setVisible(false)
    }
  }

  if (!visible) return null

  return (
    <div className="push-banner">
      <span className="push-banner__text">{t('ticket.push.prompt')}</span>
      <div className="push-banner__actions">
        <button type="button" disabled={busy} onClick={() => void handleEnable()}>
          {t('ticket.push.enable')}
        </button>
        <button type="button" className="push-banner__dismiss" onClick={() => setVisible(false)}>
          {t('ticket.push.dismiss')}
        </button>
      </div>
    </div>
  )
}
