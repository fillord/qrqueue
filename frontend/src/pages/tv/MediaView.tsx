import { useEffect, useRef, useState } from 'react'
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
  const [switching, setSwitching] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const advancingRef = useRef(false)
  const switchTimer = useRef<number | null>(null)
  const playlistKey = JSON.stringify(state.media.map((item) => [item.id, item.url]))
  const playlist = state.media.filter((item) => !failedIds.includes(item.id))
  const current = playlist[index % playlist.length]

  function switchAfterReleasingDecoder(next: () => void) {
    if (advancingRef.current) return
    advancingRef.current = true
    setSwitching(true)
    // TCL's browser can keep the previous video decoder occupied if the next
    // <video> is mounted in the same frame as the previous one is removed.
    switchTimer.current = window.setTimeout(() => {
      next()
      setSwitching(false)
      advancingRef.current = false
      switchTimer.current = null
    }, 500)
  }

  function advance() {
    if (playlist.length > 1) switchAfterReleasingDecoder(() => setIndex((value) => value + 1))
  }

  useEffect(() => {
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current)
    switchTimer.current = null
    advancingRef.current = false
    setSwitching(false)
    setIndex(0)
    setFailedIds([])
    return () => {
      if (switchTimer.current !== null) window.clearTimeout(switchTimer.current)
    }
  }, [playlistKey])
  useEffect(() => {
    if (failedIds.length === 0) return
    const retry = window.setInterval(() => switchAfterReleasingDecoder(() => setFailedIds([])), 30_000)
    return () => window.clearInterval(retry)
  }, [failedIds])
  useEffect(() => {
    if (!current || current.mime_type.startsWith('video/') || playlist.length < 2 || switching) return
    const timer = window.setTimeout(advance, state.slide_seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [current?.id, current?.mime_type, playlist.length, state.slide_seconds, switching])

  useEffect(() => {
    if (!current?.mime_type.startsWith('video/') || switching) return
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
  }, [current?.id, current?.mime_type, switching])

  if (!current) return <main className="tv-media__empty">{t('signage.noMediaContent')}</main>
  if (switching) return <main className="tv-media__content" aria-label={t('signage.noMediaContent')} />

  const finishVideo = (video: HTMLVideoElement) => {
    if (playlist.length > 1) {
      advance()
      return
    }
    video.currentTime = 0
    playMuted(video)
  }

  return <main className="tv-media__content" aria-label={current.title}>
    {current.mime_type.startsWith('video/') ? (
      <video className="tv-media__foreground" key={current.id} ref={videoRef} autoPlay muted playsInline controls={false}
        disablePictureInPicture controlsList="nodownload nofullscreen noremoteplayback" preload="auto" src={current.url}
        onLoadedMetadata={(event) => playMuted(event.currentTarget)}
        onLoadedData={(event) => playMuted(event.currentTarget)}
        onCanPlay={(event) => playMuted(event.currentTarget)}
        onTimeUpdate={(event) => {
          const video = event.currentTarget
          if (playlist.length > 1 && Number.isFinite(video.duration) && video.duration > 0
            && video.currentTime >= video.duration - 0.1) advance()
        }}
        onEnded={(event) => finishVideo(event.currentTarget)}
        onError={() => switchAfterReleasingDecoder(() =>
          setFailedIds((ids) => ids.includes(current.id) ? ids : [...ids, current.id]))} />
    ) : (
      <>
        <img className="tv-media__backdrop" key={`${current.id}-backdrop`} src={current.url} alt="" aria-hidden="true" />
        <img className="tv-media__foreground" key={current.id} src={current.url} alt={current.title}
          onError={() => switchAfterReleasingDecoder(() =>
            setFailedIds((ids) => ids.includes(current.id) ? ids : [...ids, current.id]))} />
      </>
    )}
  </main>
}
