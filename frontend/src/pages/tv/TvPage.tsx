import QRCode from 'qrcode'
import { useCallback, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { getTvQrBatch } from '../../api/tv'
import type { QrBatch, TvQueueState } from '../../api/types'
import { useLiveQr } from '../../hooks/useLiveQr'
import { useTvState } from '../../hooks/useTvState'
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

function SingleQueueView({ queue, qrToken }: { queue: TvQueueState; qrToken: string | null }) {
  const { t } = useTranslation()
  const paused = queue.queue_status !== 'open'

  return (
    <div className="tv-screen__body">
      <div className="tv-screen__main">
        <div className="tv-screen__now-serving-label">{t('tv.screen.nowServing')}</div>
        <div className="tv-screen__number">{queue.now_serving ?? '—'}</div>
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
      <div className="tv-screen__qr">
        <LiveQrCode token={qrToken} />
        <p className="tv-screen__qr-hint">{t('tv.screen.scanHint')}</p>
      </div>
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

  const singleQueue = state && state.queues.length === 1 ? state.queues[0] : null

  const fetchQrBatch = useCallback((): Promise<QrBatch> => {
    if (!deviceToken || !singleQueue) {
      return Promise.reject(new Error('no single queue to show a QR for'))
    }
    return getTvQrBatch(deviceToken)
  }, [deviceToken, singleQueue])

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
        <SingleQueueView queue={singleQueue} qrToken={qrToken} />
      ) : (
        <MultiQueueView queues={state.queues} />
      )}

      <footer className="tv-screen__footer">{t('tv.screen.footer')}</footer>
    </div>
  )
}
