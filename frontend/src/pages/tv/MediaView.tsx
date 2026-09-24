import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TvState } from '../../api/types'

export default function MediaView({ state }: { state: TvState }) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [failedIds, setFailedIds] = useState<string[]>([])
  const backdropRef = useRef<HTMLVideoElement>(null)
  const playlistKey = JSON.stringify(state.media)
  const playlist = useMemo(() => state.media.filter((item) => !failedIds.includes(item.id)), [playlistKey, failedIds])
  const current = playlist[index % playlist.length]

  useEffect(() => { setIndex(0); setFailedIds([]) }, [playlistKey])
  useEffect(() => {
    if (!current || current.mime_type.startsWith('video/')) return
    const timer = window.setTimeout(() => setIndex((value) => value + 1), state.slide_seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [current?.id, current?.mime_type, state.slide_seconds])

  function syncBackdrop(foreground: HTMLVideoElement) {
    const backdrop = backdropRef.current
    if (!backdrop) return
    if (Math.abs(backdrop.currentTime - foreground.currentTime) > 0.25) {
      backdrop.currentTime = foreground.currentTime
    }
  }

  if (!current) return <main className="tv-media__empty">{t('signage.noMediaContent')}</main>

  return <main className="tv-media__content" aria-label={current.title}>
    {current.mime_type.startsWith('video/') ? (
      <>
        <video className="tv-media__backdrop" key={`${current.id}-backdrop`} ref={backdropRef} autoPlay muted playsInline loop preload="auto" src={current.url} aria-hidden="true" tabIndex={-1} />
        <video className="tv-media__foreground" key={current.id} autoPlay muted playsInline loop={playlist.length === 1} preload="auto" src={current.url}
          onPlaying={(event) => { syncBackdrop(event.currentTarget); void backdropRef.current?.play().catch(() => undefined) }}
          onTimeUpdate={(event) => syncBackdrop(event.currentTarget)}
          onSeeked={(event) => syncBackdrop(event.currentTarget)}
          onEnded={() => setIndex((value) => value + 1)}
          onError={() => setFailedIds((ids) => ids.includes(current.id) ? ids : [...ids, current.id])} />
      </>
    ) : (
      <>
        <img className="tv-media__backdrop" key={`${current.id}-backdrop`} src={current.url} alt="" aria-hidden="true" />
        <img className="tv-media__foreground" key={current.id} src={current.url} alt={current.title}
          onError={() => setFailedIds((ids) => ids.includes(current.id) ? ids : [...ids, current.id])} />
      </>
    )}
  </main>
}
