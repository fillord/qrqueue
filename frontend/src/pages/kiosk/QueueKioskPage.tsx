import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { queueKioskApi, type KioskIntent, type KioskReceipt, type KioskState } from '../../api/queueKiosk'
import './queue-kiosk.css'

const TOKEN_KEY = 'queue.kiosk.deviceToken'
const intentKey = (id: string) => `queue.kiosk.intent.${id}`
const RESULT_SECONDS = 45

function storedToken() {
  try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

export default function QueueKioskPage() {
  const { t } = useTranslation()
  const [token, setToken] = useState(storedToken)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const unpair = useCallback(() => {
    try { localStorage.removeItem(TOKEN_KEY) } catch { /* Pair form explains storage requirements. */ }
    setToken('')
  }, [])
  if (token) return <KioskSession key={token} token={token} onUnpair={unpair} />
  return <main className="queue-kiosk"><div className="queue-kiosk__screen queue-kiosk__center">
    <h1>{t('queueKiosk.pairTitle')}</h1><p>{t('queueKiosk.pairHint')}</p>
    <form className="queue-kiosk__pair" onSubmit={async event => {
      event.preventDefault()
      if (busy) return
      setBusy(true); setError('')
      try {
        // Check storage before consuming the single-use pairing code.
        localStorage.setItem(`${TOKEN_KEY}.check`, '1'); localStorage.removeItem(`${TOKEN_KEY}.check`)
        sessionStorage.setItem(`${TOKEN_KEY}.check`, '1'); sessionStorage.removeItem(`${TOKEN_KEY}.check`)
      } catch { setError(t('queueKiosk.storage')); setBusy(false); return }
      try {
        const result = await queueKioskApi.pair(code)
        localStorage.setItem(TOKEN_KEY, result.device_token); setToken(result.device_token); setCode('')
      } catch (cause) {
        setError(t(cause instanceof ApiError && cause.status === 429 ? 'queueKiosk.errors.rate_limited'
          : cause instanceof ApiError && cause.status === 404 ? 'queueKiosk.errors.kiosk_pairing_invalid' : 'queueKiosk.error'))
      } finally { setBusy(false) }
    }}>
      <label>{t('queueKiosk.code')}<input required autoFocus inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
      <button disabled={busy || code.length !== 6}>{t(busy ? 'queueKiosk.loading' : 'queueKiosk.pair')}</button>
    </form>
    {error && <p role="alert" className="queue-kiosk__error">{error}</p>}
  </div></main>
}

function KioskSession({ token, onUnpair }: { token: string; onUnpair: () => void }) {
  const { i18n } = useTranslation()
  const [station, setStation] = useState<KioskState | null>(null)
  const [stage, setStage] = useState<'welcome' | 'choose' | 'pending' | 'result'>('welcome')
  const [intent, setIntent] = useState<KioskIntent | null>(null)
  const [receipt, setReceipt] = useState<KioskReceipt | null>(null)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(false)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [printReady, setPrintReady] = useState(false)
  const [printAttempted, setPrintAttempted] = useState(false)
  const [seconds, setSeconds] = useState(RESULT_SECONDS)
  const locked = useRef(false)
  const restored = useRef(false)
  const serviceButtons = useRef<(HTMLButtonElement | null)[]>([])
  const resultButton = useRef<HTMLButtonElement | null>(null)
  const deadline = useRef(0)
  const t = i18n.getFixedT(station?.language || i18n.language)

  const load = useCallback(async () => {
    try { const value = await queueKioskApi.state(token); setStation(value); setOnline(true) }
    catch (cause) {
      setOnline(false)
      if (cause instanceof ApiError && cause.status === 401) onUnpair()
    }
    finally { setChecked(true) }
  }, [token, onUnpair])
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => clearInterval(timer) }, [load])

  function rememberResult(value: KioskReceipt, pending: KioskIntent, stationId: string) {
    // Persist only the request ID/queue and display deadline, never visitor data.
    try { sessionStorage.setItem(intentKey(stationId), JSON.stringify({ ...pending, completedUntil: Date.now() + RESULT_SECONDS * 1000 })) }
    catch { /* Keep the result visible; the original durable request still exists. */ }
    setReceipt(value); setStage('result'); setError(''); setPrintAttempted(false)
    deadline.current = Date.now() + RESULT_SECONDS * 1000
    setSeconds(RESULT_SECONDS)
  }

  useEffect(() => {
    if (!station || restored.current) return
    restored.current = true
    try {
      const raw = sessionStorage.getItem(intentKey(station.id))
      if (!raw) return
      const pending = JSON.parse(raw) as KioskIntent
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!uuid.test(pending.request_id) || !uuid.test(pending.queue_id) || (pending.completedUntil && pending.completedUntil <= Date.now())) {
        sessionStorage.removeItem(intentKey(station.id)); return
      }
      setIntent(pending); setStage('pending'); setBusy(true); locked.current = true
      // Recover with a read: opening a page must never issue a new ticket.
      void queueKioskApi.receipt(token, pending.request_id).then(value => rememberResult(value, pending, station.id))
        .catch(cause => {
          if (cause instanceof ApiError && cause.status === 401) onUnpair()
          else setError('pending')
        }).finally(() => { setBusy(false); locked.current = false })
    } catch { setError('storage') }
  }, [station, token, onUnpair])

  function reset() {
    if (!station || locked.current || printing) return
    try { sessionStorage.removeItem(intentKey(station.id)) } catch { setError('storage'); return }
    setIntent(null); setReceipt(null); setError(''); setStage('welcome'); setPrintAttempted(false)
  }
  function choose() { setStage('choose'); setError(''); deadline.current = Date.now() + 60000 }
  useEffect(() => {
    if (stage === 'choose') serviceButtons.current.find(button => button && !button.disabled)?.focus()
    if (stage === 'result') resultButton.current?.focus()
  }, [stage])
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.repeat && (event.code === 'Space' || event.key === 'Enter')) {
        event.preventDefault(); event.stopImmediatePropagation(); return
      }
      if (event.repeat || busy || printing || !station) return
      if (stage === 'welcome' && event.code === 'Space') { event.preventDefault(); if (online) choose() }
    }
    window.addEventListener('keydown', keyboard, true)
    return () => window.removeEventListener('keydown', keyboard, true)
  }, [stage, busy, printing, station, online])
  useEffect(() => {
    if ((stage !== 'result' && stage !== 'choose') || printing) return
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))
      setSeconds(remaining)
      if (!remaining) reset()
    }, 1000)
    return () => clearInterval(timer)
  }, [stage, printing, station?.id])

  async function issue(pending: KioskIntent) {
    if (!station || locked.current) return
    locked.current = true; setBusy(true); setError(''); setIntent(pending); setStage('pending')
    try { sessionStorage.setItem(intentKey(station.id), JSON.stringify(pending)) }
    catch { setError('storage'); setBusy(false); locked.current = false; return }
    try { rememberResult(await queueKioskApi.issue(token, pending), pending, station.id) }
    catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onUnpair()
      else if (cause instanceof ApiError && [404, 422, 429].includes(cause.status)) {
        sessionStorage.removeItem(intentKey(station.id)); setIntent(null); setStage('choose')
        deadline.current = Date.now() + 60000
        setError(`errors.${cause.code}`); void load()
      } else setError('pending')
    } finally { locked.current = false; setBusy(false) }
  }

  function finishPrinting() {
    setPrinting(false); setPrintReady(false); locked.current = false
    deadline.current = Date.now() + RESULT_SECONDS * 1000; setSeconds(RESULT_SECONDS)
    if (station && intent) {
      try { sessionStorage.setItem(intentKey(station.id), JSON.stringify({ ...intent, completedUntil: deadline.current })) }
      catch { /* The already-issued ticket remains visible even if storage becomes unavailable. */ }
    }
  }
  useEffect(() => {
    if (!printReady) return
    const after = () => finishPrinting()
    window.addEventListener('afterprint', after)
    const frame = requestAnimationFrame(() => {
      try { window.print(); setPrintAttempted(true) }
      catch { finishPrinting(); setError('error') }
    })
    return () => { cancelAnimationFrame(frame); window.removeEventListener('afterprint', after) }
  }, [printReady])

  async function print() {
    if (!receipt || locked.current) return
    locked.current = true; setPrinting(true); setError('')
    try {
      const value = await queueKioskApi.print(token, receipt.request_id)
      setReceipt(value); setPrintReady(true)
    } catch (cause) {
      finishPrinting()
      if (cause instanceof ApiError && cause.status === 401) onUnpair()
      else {
        setError(cause instanceof ApiError && cause.code === 'kiosk_printing_disabled' ? 'errors.kiosk_printing_disabled' : 'error')
        void load()
      }
    }
  }
  const translatedError = error && (i18n.exists(`queueKiosk.${error}`) ? t(`queueKiosk.${error}`) : t('queueKiosk.error'))
  const canPrint = Boolean(receipt?.printing_enabled && station?.printing_enabled)
  const pageStyle = `@page { size: ${receipt?.paper_width || 80}mm ${receipt?.paper_width === 58 ? 190 : 150}mm; margin: 3mm; }`
  return <main className="queue-kiosk" lang={station?.language}>
    {receipt && canPrint && <style>{pageStyle}</style>}
    <div className="queue-kiosk__screen">
      <header className="queue-kiosk__header"><strong>{station?.organization_name || 'OmniBook'}</strong><span>{station?.name}</span></header>
      {checked && !online && <p role="alert" className="queue-kiosk__error">{t('queueKiosk.error')} <button disabled={busy} onClick={() => void load()}>{t('queueKiosk.retry')}</button></p>}
      {translatedError && <p role="alert" className="queue-kiosk__error">{translatedError}</p>}
      {!checked && <p role="status">{t('queueKiosk.loading')}</p>}
      {station && stage === 'welcome' && <section className="queue-kiosk__center">
        <h1>{t('queueKiosk.welcome')}</h1><button autoFocus className="queue-kiosk__start" disabled={!online} onClick={choose}>{t('queueKiosk.start')}</button><p>{t('queueKiosk.space')}</p>
      </section>}
      {station && stage === 'choose' && <section className="queue-kiosk__services" onPointerDown={() => { deadline.current = Date.now() + 60000 }} onKeyDown={event => {
        deadline.current = Date.now() + 60000
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
        const buttons = serviceButtons.current.filter((button): button is HTMLButtonElement => Boolean(button && !button.disabled))
        if (!buttons.length) return
        event.preventDefault()
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const step = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1
        buttons[(current + step + buttons.length) % buttons.length]?.focus()
      }}>
        <h1>{t('queueKiosk.choose')}</h1><p>{t('queueKiosk.keyboard')}</p>
        {!station.queues.some(q => !q.unavailable_reason) && <p>{t('queueKiosk.emptyServices')}</p>}
        <div className="queue-kiosk__grid">{station.queues.map((queue, index) => <button className="queue-kiosk__service" key={queue.id} ref={element => { serviceButtons.current[index] = element }} disabled={!online || Boolean(queue.unavailable_reason)} onClick={() => void issue({ queue_id: queue.id, request_id: crypto.randomUUID() })}>
          {queue.name}{queue.unavailable_reason && <span>{t(`queueKiosk.errors.${queue.unavailable_reason}`)}</span>}
        </button>)}</div>
        <button className="queue-kiosk__secondary" onClick={reset}>{t('queueKiosk.back')}</button>
      </section>}
      {stage === 'pending' && <section className="queue-kiosk__center"><h1>{t('queueKiosk.issuing')}</h1>
        {!busy && intent && <button onClick={() => void issue(intent)}>{t('queueKiosk.retry')}</button>}
      </section>}
      {stage === 'result' && receipt && <section className="queue-kiosk__center queue-kiosk__result" aria-live="polite">
        <h1>{t('queueKiosk.yourTicket')}</h1><strong className="queue-kiosk__number">{receipt.display_number}</strong>
        <p>{receipt.queue_name}</p><p>{t('queueKiosk.ahead', { count: receipt.ahead })}</p><p>{t('queueKiosk.wait')}</p>
        <div className="queue-kiosk__actions">
          {canPrint && <button disabled={printing} onClick={() => void print()}>{t(`queueKiosk.${printAttempted ? 'reprint' : 'print'}`)}</button>}
          <button ref={resultButton} className="queue-kiosk__secondary" disabled={printing} onClick={reset}>{t('queueKiosk.done')}</button>
        </div>
        {canPrint && <p>{t('queueKiosk.printHint')}</p>}
        {printing ? <button className="queue-kiosk__secondary" disabled={!printReady} onClick={finishPrinting}>{t('queueKiosk.printReturn')}</button> : <p>{t('queueKiosk.resetIn', { count: seconds })}</p>}
      </section>}
    </div>
    {receipt && canPrint && <article className="queue-kiosk-receipt" aria-hidden="true">
      <h1>{receipt.organization_name}</h1><p>{receipt.queue_name}</p><hr />
      <p>{t('queueKiosk.yourTicket')}</p><strong>{receipt.display_number}</strong><hr />
      <p>{new Date(receipt.created_at).toLocaleString(receipt.language, { timeZone: receipt.timezone })}</p><p>{t('queueKiosk.wait')}</p>
    </article>}
  </main>
}
