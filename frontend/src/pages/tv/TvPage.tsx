import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { getTvQrBatch } from '../../api/tv'
import type { QrBatch, TvQueueState } from '../../api/types'
import { useLiveQr } from '../../hooks/useLiveQr'
import { useTvAnnouncer } from '../../hooks/useTvAnnouncer'
import { useTvState } from '../../hooks/useTvState'
import { isAnnouncementsEnabled, setAnnouncementsEnabled } from '../../lib/tvAnnouncements'
import { forgetDeviceToken, getRememberedDeviceToken } from '../../lib/tvDevice'

function LiveQrCode({ token }: { token: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!token || !canvasRef.current) return
    const url = `${window.location.origin}/q?t=${encodeURIComponent(token)}`
    void QRCode.toCanvas(canvasRef.current, url, { width: 280, margin: 1 })
  }, [token])

  return <canvas ref={canvasRef} className="tv-screen__qr-canvas" />
}

function SingleQueueView({
  queue,
  qrToken,
  showQr,
}: {
  queue: TvQueueState
  qrToken: string | null
  showQr: boolean
}) {
  const { t } = useTranslation()
  const paused = queue.queue_status !== 'open'

  return (
    <div className="tv-screen__body">
      <div className="tv-screen__main">
        <div className="tv-screen__now-serving-label">{t('tv.screen.nowServing')}</div>
        {queue.now_serving ? (
          <div className="tv-screen__number">{queue.now_serving}</div>
        ) : (
          <p className="tv-screen__no-calls">{t('tv.screen.noOneCalled')}</p>
        )}
        {queue.now_serving_cabinet && (
          <div className="tv-screen__cabinet">
            {t('tv.screen.cabinet', { label: queue.now_serving_cabinet })}
          </div>
        )}
        <div className="tv-screen__waiting">{t('tv.screen.waiting', { count: queue.waiting_count })}</div>
        {paused && (
          <div className={`tv-screen__banner tv-screen__banner--${queue.queue_status}`}>
            {t(`tv.screen.queueStatus.${queue.queue_status}`)}
          </div>
        )}
      </div>
      {showQr ? (
        <div className="tv-screen__qr">
          <LiveQrCode token={qrToken} />
          <p className="tv-screen__qr-hint">{t('tv.screen.scanHint')}</p>
        </div>
      ) : (
        <div className="tv-screen__qr tv-screen__qr--instructions">
          <p className="tv-screen__qr-hint">{t('tv.screen.hallScanHint')}</p>
        </div>
      )}
    </div>
  )
}

function MultiQueueView({ queues }: { queues: TvQueueState[] }) {
  const { t } = useTranslation()

  return (
    <div className="tv-screen__list">
      {queues.map((queue) => (
        <div key={queue.queue_id} className="tv-screen__list-row">
          <span className="tv-screen__list-name">{queue.queue_name}</span>
          <span className="tv-screen__list-number">{queue.now_serving ?? '—'}</span>
          <span className="tv-screen__list-waiting">{t('tv.screen.waiting', { count: queue.waiting_count })}</span>
          {queue.queue_status !== 'open' && (
            <span className={`tv-screen__list-status tv-screen__list-status--${queue.queue_status}`}>
              {t(`tv.screen.queueStatus.${queue.queue_status}`)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export default function TvPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const deviceToken = getRememberedDeviceToken()

  useEffect(() => {
    if (!deviceToken) navigate('/tv/pair', { replace: true })
  }, [deviceToken, navigate])

  const { state, loading, rejected } = useTvState(deviceToken ?? '')

  useEffect(() => {
    if (rejected) {
      forgetDeviceToken()
      navigate('/tv/pair', { replace: true })
    }
  }, [rejected, navigate])

  const [announcementsEnabled, setAnnouncementsEnabledState] = useState(isAnnouncementsEnabled)
  useTvAnnouncer(state, announcementsEnabled)

  function toggleAnnouncements() {
    const next = !announcementsEnabled
    setAnnouncementsEnabledState(next)
    setAnnouncementsEnabled(next)
  }

  const singleQueue = state && state.queues.length === 1 ? state.queues[0] : null
  // A hall screen (tv_screens.queue_id = null) can have exactly one active
  // queue right now and still look like a single-queue screen by `queues`
  // alone — `is_hall_screen` is the only true signal for whether /tv/qr-batch
  // will actually return a QR (it 409s for any hall screen, regardless of
  // queue count). Gating on that, not on `singleQueue`, is what stops the
  // repeated-409 loop.
  const showQr = state != null && !state.is_hall_screen

  const fetchQrBatch = useCallback((): Promise<QrBatch> => {
    if (!deviceToken || !showQr) {
      return Promise.reject(new Error('this screen has no queue to show a QR for'))
    }
    return getTvQrBatch(deviceToken)
  }, [deviceToken, showQr])

  const { token: qrToken } = useLiveQr(fetchQrBatch)

  if (!deviceToken) return null

  if (loading || !state) {
    return (
      <div className="tv-screen tv-screen--loading">
        <div className="spinner" aria-hidden="true" />
      </div>
    )
  }

  const style = state.brand_color ? ({ '--tv-brand': state.brand_color } as CSSProperties) : undefined

  return (
    <div className="tv-screen" style={style}>
      <header className="tv-screen__header">
        {state.logo_url && <img className="tv-screen__logo" src={state.logo_url} alt="" />}
        <span className="tv-screen__org">{state.organization_name}</span>
      </header>

      {singleQueue ? (
        <SingleQueueView queue={singleQueue} qrToken={qrToken} showQr={showQr} />
      ) : (
        <MultiQueueView queues={state.queues} />
      )}

      <footer className="tv-screen__footer">
        <span>{t('tv.screen.footer')}</span>
        <button type="button" className="tv-screen__announce-toggle" onClick={toggleAnnouncements}>
          {t(announcementsEnabled ? 'tv.announce.toggleOn' : 'tv.announce.toggleOff')}
        </button>
      </footer>
    </div>
  )
}
