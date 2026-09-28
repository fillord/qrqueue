import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TvState } from '../../api/types'

function playMuted(video: HTMLVideoElement) {
  video.muted = true
  video.defaultMuted = true
  video.controls = false
  video.removeAttribute('controls')
  const attempt = video.play()
  if (attempt) void attempt.catch(() => undefined)
}

export default function MediaView({ state }: { state: TvState }) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [failedIds, setFailedIds] = useState<string[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const playlistKey = JSON.stringify(state.media)
  const playlist = useMemo(() => state.media.filter((item) => !failedIds.includes(item.id)), [playlistKey, failedIds])
  const current = playlist[index % playlist.length]

  useEffect(() => { setIndex(0); setFailedIds([]) }, [playlistKey])
  useEffect(() => {
    if (!current || current.mime_type.startsWith('video/')) return
    const timer = window.setTimeout(() => setIndex((value) => value + 1), state.slide_seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [current?.id, current?.mime_type, state.slide_seconds])

  useEffect(() => {
    if (!current?.mime_type.startsWith('video/')) return
    const tryPlay = () => {
      const video = videoRef.current
      if (!video) return
      playMuted(video)
    }
    const timers = [0, 500, 1500, 4000, 8000, 15000].map((delay) => window.setTimeout(tryPlay, delay))
    const retry = window.setInterval(() => {
      const video = videoRef.current
      if (video && video.paused && !video.ended) tryPlay()
    }, 5000)
    const resume = () => { if (document.visibilityState === 'visible') tryPlay() }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', tryPlay)
    window.addEventListener('pageshow', tryPlay)
    window.addEventListener('keydown', tryPlay)
    window.addEventListener('pointerdown', tryPlay)
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      window.clearInterval(retry)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', tryPlay)
      window.removeEventListener('pageshow', tryPlay)
      window.removeEventListener('keydown', tryPlay)
      window.removeEventListener('pointerdown', tryPlay)
    }
  }, [current?.id, current?.mime_type])

  if (!current) return <main className="tv-media__empty">{t('signage.noMediaContent')}</main>

  return <main className="tv-media__content" aria-label={current.title}>
    {current.mime_type.startsWith('video/') ? (
      <video className="tv-media__foreground" key={current.id} ref={videoRef} autoPlay muted playsInline controls={false}
        disablePictureInPicture controlsList="nodownload nofullscreen noremoteplayback" loop={playlist.length === 1} preload="auto" src={current.url}
        onLoadedMetadata={(event) => playMuted(event.currentTarget)}
        onLoadedData={(event) => playMuted(event.currentTarget)}
        onCanPlay={(event) => playMuted(event.currentTarget)}
        onEnded={() => setIndex((value) => value + 1)}
        onError={() => setFailedIds((ids) => ids.includes(current.id) ? ids : [...ids, current.id])} />
    ) : (
      <>
        <img className="tv-media__backdrop" key={`${current.id}-backdrop`} src={current.url} alt="" aria-hidden="true" />
        <img className="tv-media__foreground" key={current.id} src={current.url} alt={current.title}
          onError={() => setFailedIds((ids) => ids.includes(current.id) ? ids : [...ids, current.id])} />
      </>
    )}
  </main>
}
