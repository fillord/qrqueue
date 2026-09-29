import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TvState } from '../../api/types'
import YouTubePlayer from './YouTubePlayer'

export default function MediaView({ state }: { state: TvState }) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [failedIds, setFailedIds] = useState<string[]>([])
  const playlistKey = JSON.stringify(state.media.map((item) => [item.id, item.url]))
  const playlist = state.media.filter((item) => !failedIds.includes(item.id))
  const current = playlist[index % playlist.length]

  useEffect(() => { setIndex(0); setFailedIds([]) }, [playlistKey])
  useEffect(() => {
    if (!failedIds.length) return
    const timer = window.setInterval(() => setFailedIds([]), 30_000)
    return () => window.clearInterval(timer)
  }, [failedIds.length])
  useEffect(() => {
    if (!current || current.kind !== 'advertisement' || playlist.length < 2) return
    const timer = window.setTimeout(() => setIndex((value) => value + 1), state.slide_seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [current?.id, current?.kind, playlist.length, state.slide_seconds])

  if (!current) return <main className="tv-media__empty">{t(failedIds.length ? 'signage.youtubeUnavailable' : 'signage.noMediaContent')}</main>
  const fail = () => setFailedIds((ids) => ids.includes(current.id) ? ids : [...ids, current.id])
  return <main className="tv-media__content" aria-label={current.title}>
    {current.kind !== 'advertisement' ? (
      <YouTubePlayer key={`${current.id}-${playlist.length === 1}`} item={current} repeat={playlist.length === 1}
        onComplete={() => setIndex((value) => value + 1)} onFailure={fail} />
    ) : <>
      <img className="tv-media__backdrop" src={current.url} alt="" aria-hidden="true" />
      <img className="tv-media__foreground" src={current.url} alt={current.title} onError={fail} />
    </>}
  </main>
}
