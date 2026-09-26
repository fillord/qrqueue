import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { getTvQrBatch } from '../../api/tv'
import type { QrBatch, TvQueueState, TvRecentCall, TvState } from '../../api/types'
import { useLiveQr } from '../../hooks/useLiveQr'
import { speakTvAnnouncement, useTvAnnouncer } from '../../hooks/useTvAnnouncer'
import { useTvSpotlight } from '../../hooks/useTvSpotlight'
import { useTvState } from '../../hooks/useTvState'
import { getSelectedTvVoiceUri, isAnnouncementsEnabled, setAnnouncementsEnabled, setSelectedTvVoiceUri } from '../../lib/tvAnnouncements'
import { forgetDeviceToken, getRememberedDeviceToken } from '../../lib/tvDevice'
import MediaView from './MediaView'
import ScheduleView from './ScheduleView'

function MediaClock({ timezone, language }: { timezone: string; language: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  const date = new Intl.DateTimeFormat(language, { timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(now)
  const time = new Intl.DateTimeFormat(language, { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(now)
  return <time className="tv-media__clock" dateTime={now.toISOString()}>{date}<span>{time}</span></time>
}

function LiveQrCode({ token, hall = false }: { token: string | null; hall?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!token || !canvasRef.current) return
    const canvas = canvasRef.current
    const url = `${window.location.origin}/q?t=${encodeURIComponent(token)}${hall ? '&mode=hall' : ''}`
    void QRCode.toCanvas(canvas, url, { width: 480, margin: 1 }).then(() => {
      // qrcode writes fixed inline dimensions; let the TV layout scale the
      // 480px drawing down on narrower or portrait screens.
      canvas.style.removeProperty('width')
      canvas.style.removeProperty('height')
    })
  }, [token, hall])

  return <canvas ref={canvasRef} className="tv-screen__qr-canvas" />
}

function SingleQueueView({
  queue,
  recentCalls,
  qrToken,
  showQr,
}: {
  queue: TvQueueState
  recentCalls: TvRecentCall[]
  qrToken: string | null
  showQr: boolean
}) {
  const { t } = useTranslation()
  const paused = queue.queue_status !== 'open'

  return (
    <div className="tv-screen__body">
      <div className="tv-screen__main">
        <RecentCalls calls={recentCalls} />
        <div className="tv-screen__now-serving-label">{t('tv.screen.currentCalls')}</div>
        <ActiveCalls queue={queue} />
        <div className="tv-screen__waiting">{t('tv.screen.waiting', { count: queue.waiting_count })}</div>
        {paused && (
          <div className={`tv-screen__banner tv-screen__banner--${queue.queue_status}`}>
            {t(`tv.screen.queueStatus.${queue.queue_status}`)}
          </div>
        )}
      </div>
      {showQr ? (
        <div className="tv-screen__qr">
          {qrToken && <LiveQrCode token={qrToken} />}
          <p className="tv-screen__qr-hint">{t(qrToken ? 'tv.screen.scanHint' : 'tv.screen.qrUnavailable')}</p>
        </div>
      ) : (
        <div className="tv-screen__qr tv-screen__qr--instructions">
          <p className="tv-screen__qr-hint">{t('tv.screen.hallScanHint')}</p>
        </div>
      )}
    </div>
  )
}

function RecentCalls({ calls, showQueue = false }: { calls: TvRecentCall[]; showQueue?: boolean }) {
  const { t } = useTranslation()
  return <section className="tv-screen__recent" aria-label={t('tv.screen.recentCalls')}>
    {[0, 1].map((index) => {
      const call = calls[index]
      return <div key={index} className={`tv-screen__recent-card${index === 0 ? ' tv-screen__recent-card--latest' : ''}`}>
        <div className="tv-screen__recent-label">{t(index === 0 ? 'tv.screen.latestCall' : 'tv.screen.previousCall')}</div>
        {call ? <>
          <div className="tv-screen__recent-number">{call.display_number}</div>
          {showQueue && <div className="tv-screen__recent-queue">{call.queue_name}</div>}
          {call.cabinet_label && <div className="tv-screen__recent-cabinet">{t('tv.screen.cabinet', { label: call.cabinet_label })}</div>}
        </> : <div className="tv-screen__recent-empty">—</div>}
      </div>
    })}
  </section>
}

function ActiveCalls({ queue }: { queue: TvQueueState }) {
  const { t } = useTranslation()
  return queue.active_calls.length ? (
    <div className={`tv-screen__calls ${queue.active_calls.length > 1 ? 'tv-screen__calls--multiple' : ''}`}>
      {queue.active_calls.map((call) => (
        <div key={call.ticket_id} className="tv-screen__call">
          <div className="tv-screen__number">{call.display_number}</div>
          {call.cabinet_label && <div className="tv-screen__cabinet">{t('tv.screen.cabinet', { label: call.cabinet_label })}</div>}
        </div>
      ))}
    </div>
  ) : <p className="tv-screen__no-calls">{t('tv.screen.noOneCalled')}</p>
}

function MultiQueueView({ queues, recentCalls, qrToken }: { queues: TvQueueState[]; recentCalls: TvRecentCall[]; qrToken: string | null }) {
  const { t } = useTranslation()

  return (
    <div className="tv-screen__hall-body">
      <div className="tv-screen__list">
        <RecentCalls calls={recentCalls} showQueue />
        {queues.map((queue) => (
          <div key={queue.queue_id} className="tv-screen__list-row">
            <span className="tv-screen__list-name">{queue.queue_name}</span>
            <ActiveCalls queue={queue} />
            <span className="tv-screen__list-waiting">{t('tv.screen.waiting', { count: queue.waiting_count })}</span>
            {queue.queue_status !== 'open' && (
              <span className={`tv-screen__list-status tv-screen__list-status--${queue.queue_status}`}>
                {t(`tv.screen.queueStatus.${queue.queue_status}`)}
              </span>
            )}
          </div>
        ))}
      </div>
      {queues.length > 0 && <aside className="tv-screen__hall-qr">
        {qrToken && <LiveQrCode token={qrToken} hall />}
        <p>{t(qrToken ? 'tv.screen.hallChooseHint' : 'tv.screen.qrUnavailable')}</p>
      </aside>}
    </div>
  )
}

export function TvDisplay({ state, preview = false }: { state: TvState; preview?: boolean }) {
  const { t } = useTranslation()
  const style = state.brand_color ? ({ '--tv-brand': state.brand_color } as CSSProperties) : undefined
  const singleQueue = state.queues.length === 1 ? state.queues[0] : null
  if (state.display_mode === 'media') return <div className="tv-screen tv-screen--media" style={style}>
    <header className="tv-media__header"><span className="tv-media__organization">{state.organization_name}</span><MediaClock timezone={state.timezone} language={state.language} /></header>
    <MediaView state={state} />
  </div>
  return <div className={`tv-screen${state.display_mode === 'schedule' ? ' tv-screen--schedule' : ''}`} style={style}>
    <header className="tv-screen__header">
      {state.logo_url && <img className="tv-screen__logo" src={state.logo_url} alt="" />}
      <span className="tv-screen__org">{state.organization_name}</span>
    </header>
    {state.display_mode === 'schedule' ? <ScheduleView state={state} /> : singleQueue && !state.is_hall_screen
      ? <SingleQueueView queue={singleQueue} recentCalls={state.recent_calls} qrToken={null} showQr />
      : <MultiQueueView queues={state.queues} recentCalls={state.recent_calls} qrToken={null} />}
    {state.display_mode === 'queue' && <footer className="tv-screen__footer">{preview ? t('adminTv.preview.noQr') : t('tv.screen.footer')}</footer>}
  </div>
}

export default function TvPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const deviceToken = getRememberedDeviceToken()

  useEffect(() => {
    if (!deviceToken) navigate('/tv/pair', { replace: true })
  }, [deviceToken, navigate])

  const { state, loading, rejected, offline } = useTvState(deviceToken ?? '')
  useEffect(() => { if (state) void i18n.changeLanguage(state.language) }, [state?.language, i18n])

  useEffect(() => {
    if (rejected) {
      forgetDeviceToken()
      navigate('/tv/pair', { replace: true })
    }
  }, [rejected, navigate])

  const [announcementsEnabled, setAnnouncementsEnabledState] = useState(isAnnouncementsEnabled)
  const [selectedVoiceUri, setSelectedVoiceUriState] = useState(getSelectedTvVoiceUri)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    const refresh = () => setVoices(synth.getVoices?.() ?? [])
    refresh()
    synth.addEventListener?.('voiceschanged', refresh)
    return () => synth.removeEventListener?.('voiceschanged', refresh)
  }, [])

  const voiceOptions = voices.filter((voice) => voice.lang.toLowerCase().split(/[-_]/)[0] === state?.language)
  const voiceChoice = voiceOptions.some((voice) => voice.voiceURI === selectedVoiceUri) ? selectedVoiceUri : ''
  useTvAnnouncer(state?.display_mode === 'queue' ? state : null, announcementsEnabled, voiceChoice)
  const spotlight = useTvSpotlight(state?.display_mode === 'queue' ? state : null)

  function toggleAnnouncements() {
    const next = !announcementsEnabled
    setAnnouncementsEnabledState(next)
    setAnnouncementsEnabled(next)
  }

  function changeVoice(voiceUri: string) {
    setSelectedVoiceUriState(voiceUri)
    setSelectedTvVoiceUri(voiceUri)
  }

  function previewVoice() {
    if (!state || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    speakTvAnnouncement(t('tv.announce.calledWithCabinet', { number: 'А001', cabinet: '108' }), state.language, voiceChoice)
  }

  const singleQueue = state && state.queues.length === 1 ? state.queues[0] : null
  const showQr = state != null && state.display_mode === 'queue' && state.queues.length > 0
  const qrTarget = state?.display_mode === 'queue'
    ? (state.is_hall_screen ? 'hall' : singleQueue?.queue_id ?? '')
    : ''

  const fetchQrBatch = useCallback((): Promise<QrBatch> => {
    if (!deviceToken || !showQr || !qrTarget) {
      return Promise.reject(new Error('this screen has no queue to show a QR for'))
    }
    return getTvQrBatch(deviceToken)
  }, [deviceToken, showQr, qrTarget])

  const { token: qrToken, offline: qrOffline } = useLiveQr(fetchQrBatch, !!deviceToken && showQr)

  if (!deviceToken) return null

  if (loading || !state) {
    return (
      <div className="tv-screen tv-screen--loading">
        <div className="spinner" aria-hidden="true" />
        {offline && <p role="status">{t('tv.screen.offline')}</p>}
      </div>
    )
  }

  const style = state.brand_color ? ({ '--tv-brand': state.brand_color } as CSSProperties) : undefined

  if (state.display_mode === 'media') {
    return <div className="tv-screen tv-screen--media" style={style}>
      <header className="tv-media__header">
        <span className="tv-media__organization">{state.organization_name}</span>
        <MediaClock timezone={state.timezone} language={state.language} />
      </header>
      <MediaView state={state} />
    </div>
  }

  return (
    <div className={`tv-screen${state.display_mode === 'schedule' ? ' tv-screen--schedule' : ''}`} style={style}>
      <header className="tv-screen__header">
        {state.logo_url && <img className="tv-screen__logo" src={state.logo_url} alt="" />}
        <span className="tv-screen__org">{state.organization_name}</span>
      </header>

      {state.display_mode === 'schedule' ? <ScheduleView state={state} /> : singleQueue && !state.is_hall_screen ? (
        <SingleQueueView queue={singleQueue} recentCalls={state.recent_calls} qrToken={qrToken} showQr={showQr} />
      ) : (
        <MultiQueueView queues={state.queues} recentCalls={state.recent_calls} qrToken={qrToken} />
      )}

      {state.display_mode === 'queue' && <footer className="tv-screen__footer">
        {(offline || qrOffline) && <span role="status">{t('tv.screen.offline')}</span>}
        <span>{t('tv.screen.footer')}</span>
        <button type="button" className="tv-screen__announce-toggle" onClick={toggleAnnouncements}>
          {t(announcementsEnabled ? 'tv.announce.toggleOn' : 'tv.announce.toggleOff')}
        </button>
        <details className="tv-screen__voice-settings">
          <summary>{t('tv.announce.voiceSettings')}</summary>
          <div className="tv-screen__voice-menu">
            <label>{t('tv.announce.voiceChoice')}
              <select value={voiceChoice} onChange={(event) => changeVoice(event.target.value)}>
                <option value="">{t('tv.announce.automaticVoice')}</option>
                {voiceOptions.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}
              </select>
            </label>
            <button type="button" onClick={previewVoice}>{t('tv.announce.previewVoice')}</button>
          </div>
        </details>
      </footer>}
      {state.display_mode === 'queue' && spotlight && <div className="tv-spotlight" role="status" aria-live="assertive" aria-atomic="true">
        <div className="tv-spotlight__card" key={`${spotlight.ticket_id}-${spotlight.call_count}`}>
          <span className="tv-spotlight__label">{t('tv.screen.newCall')}</span>
          <strong className="tv-spotlight__number">{spotlight.display_number}</strong>
          {(state.is_hall_screen || state.queues.length > 1) && <span className="tv-spotlight__queue">{spotlight.queue_name}</span>}
          {spotlight.cabinet_label && <span className="tv-spotlight__cabinet">{t('tv.screen.cabinet', { label: spotlight.cabinet_label })}</span>}
        </div>
      </div>}
    </div>
  )
}
