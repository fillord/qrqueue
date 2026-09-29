import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TvMediaState } from '../../api/types'

interface Player {
  destroy(): void
  mute(): void
  playVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getPlaylist(): string[] | undefined
  getPlaylistIndex(): number
  nextVideo(): void
  getIframe(): HTMLIFrameElement
}
interface PlayerEvent { target: Player }
interface PlayerStateEvent extends PlayerEvent { data: number }
interface YouTubeApi {
  Player: new (element: HTMLElement, options: {
    videoId?: string
    playerVars: Record<string, string | number>
    events: Record<string, (event: PlayerEvent | PlayerStateEvent) => void>
  }) => Player
  PlayerState: { ENDED: number; PLAYING: number }
}
declare global {
  interface Window { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void }
}

let apiPromise: Promise<YouTubeApi> | null = null
function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const script = document.createElement('script')
    const oldReady = window.onYouTubeIframeAPIReady
    const timer = window.setTimeout(() => { apiPromise = null; reject(new Error('YouTube API timeout')) }, 15_000)
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer)
      oldReady?.()
      if (window.YT?.Player) resolve(window.YT)
      else { apiPromise = null; reject(new Error('YouTube API unavailable')) }
    }
    script.onerror = () => { window.clearTimeout(timer); apiPromise = null; reject(new Error('YouTube API failed')) }
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    document.head.appendChild(script)
  })
  return apiPromise
}

export default function YouTubePlayer({ item, repeat, onComplete, onFailure }: {
  item: TvMediaState; repeat: boolean; onComplete: () => void; onFailure: () => void
}) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<Player | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const itemId = item.url.match(/(?:\/embed\/|[?&]list=)([A-Za-z0-9_-]+)/)?.[1] ?? ''
  const isPlaylist = item.kind === 'youtube_playlist'

  useEffect(() => {
    let canceled = false
    let failedPlaylistItems = 0
    setBlocked(false)
    setUnavailable(false)
    if (!itemId) { onFailure(); return }
    void loadYouTubeApi().then((YT) => {
      if (canceled || !host.current) return
      const playerVars: Record<string, string | number> = {
        autoplay: 1, controls: 0, mute: 1, playsinline: 1, rel: 0,
        origin: window.location.origin,
      }
      if (isPlaylist) {
        playerVars.listType = 'playlist'
        playerVars.list = itemId
        playerVars.loop = repeat ? 1 : 0
      } else if (repeat) {
        playerVars.loop = 1
        playerVars.playlist = itemId
      }
      player.current = new YT.Player(host.current, {
        ...(isPlaylist ? {} : { videoId: itemId }), playerVars,
        events: {
          onReady: (event) => {
            if (canceled) return
            const target = event.target
            target.getIframe().setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture')
            target.mute()
            target.playVideo()
          },
          onStateChange: (event) => {
            if (canceled) return
            const state = event as PlayerStateEvent
            if (state.data === YT.PlayerState.PLAYING) { failedPlaylistItems = 0; setBlocked(false); setUnavailable(false) }
            if (state.data !== YT.PlayerState.ENDED) return
            if (isPlaylist) {
              const playlist = state.target.getPlaylist() ?? []
              if (playlist.length > 0 && state.target.getPlaylistIndex() < playlist.length - 1) return
            }
            if (repeat) { state.target.seekTo(0, true); state.target.playVideo() }
            else onComplete()
          },
          onError: (event) => {
            if (canceled) return
            const playlist = isPlaylist ? event.target.getPlaylist() ?? [] : []
            failedPlaylistItems += 1
            if (playlist.length > failedPlaylistItems) { event.target.nextVideo(); return }
            setUnavailable(true)
            onFailure()
          },
          onAutoplayBlocked: () => { if (!canceled) setBlocked(true) },
        },
      })
    }).catch(() => { if (!canceled) { setUnavailable(true); onFailure() } })
    return () => {
      canceled = true
      player.current?.destroy()
      player.current = null
    }
  }, [item.id, itemId, isPlaylist, repeat])

  useEffect(() => {
    if (!blocked) return
    const start = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); player.current?.playVideo() }
    }
    window.addEventListener('keydown', start)
    return () => window.removeEventListener('keydown', start)
  }, [blocked])

  return <>
    <div className="tv-media__youtube" ref={host} />
    {blocked && <button type="button" className="tv-media__start" onClick={() => player.current?.playVideo()}>{t('signage.youtubeStart')}</button>}
    {unavailable && repeat && <p className="tv-media__error">{t('signage.youtubeUnavailable')}</p>}
  </>
}
