import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost } from '../api/client'

export default function TelegramTicketBanner({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<{ available: boolean; connected: boolean } | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    let current = true
    const refresh = () => { void apiGet<{ available: boolean; connected: boolean }>(`/api/public/tickets/${ticketId}/telegram`).then(value => { if (current) setState(value) }).catch(() => {}) }
    refresh(); window.addEventListener('focus', refresh)
    return () => { current = false; window.removeEventListener('focus', refresh) }
  }, [ticketId])
  async function connect() {
    setBusy(true); setError(false)
    try { const link = await apiPost<{ url: string }>(`/api/public/tickets/${ticketId}/telegram`); setUrl(link.url) }
    catch { setError(true) }
    finally { setBusy(false) }
  }
  if (!state?.available) return null
  return <div className="push-banner">
    <p>{t(state.connected ? 'workforce.connected' : 'workforce.prompt')}</p>
    {state.connected ? <small>{t('workforce.stop')}</small> : url ? <a href={url} target="_blank" rel="noreferrer">{t('workforce.open')}</a> : <button type="button" disabled={busy} onClick={() => void connect()}>{t('workforce.telegram')}</button>}
    {error && <p role="alert">{t('workforce.error')}</p>}
  </div>
}
