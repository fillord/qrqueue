import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TvState } from '../../api/types'

function playMuted(video: HTMLVideoElement) {
  video.muted = true
  video.defaultMuted = true
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
    const timers = [0, 500, 1500, 4000].map((delay) => window.setTimeout(tryPlay, delay))
    const resume = () => { if (document.visibilityState === 'visible') tryPlay() }
    document.addEventListener('visibilitychange', resume)
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      document.removeEventListener('visibilitychange', resume)
    }
  }, [current?.id, current?.mime_type])

  if (!current) return <main className="tv-media__empty">{t('signage.noMediaContent')}</main>

  return <main className="tv-media__content" aria-label={current.title}>
    {current.mime_type.startsWith('video/') ? (
      <video className="tv-media__foreground" key={current.id} ref={videoRef} autoPlay muted playsInline loop={playlist.length === 1} preload="auto" src={current.url}
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
