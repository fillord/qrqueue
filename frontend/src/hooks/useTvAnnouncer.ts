import i18n from 'i18next'
import { useEffect, useRef } from 'react'

import type { TvState } from '../api/types'

const SPEECH_LANG: Record<TvState['language'], string> = {
  kk: 'kk-KZ',
  ru: 'ru-RU',
  en: 'en-US',
}

/**
 * Speaks newly-called ticket numbers via the browser's built-in
 * SpeechSynthesis — no dependency. Diffs each queue's `now_serving` against
 * the previous snapshot rather than reacting to a WS event type, since
 * /ws/tv always pushes a full state snapshot (ARCHITECTURE.md section 5
 * doesn't carry a discrete event payload down to the TV). The first
 * snapshot after mount only seeds the comparison baseline — it never
 * announces whatever was already being served before the screen loaded.
 */
export function useTvAnnouncer(state: TvState | null, enabled: boolean): void {
  const previousRef = useRef<Map<string, string | null> | null>(null)

  useEffect(() => {
    if (!state) return

    const previous = previousRef.current
    const current = new Map(state.queues.map((q) => [q.queue_id, q.now_serving]))

    if (previous && enabled && 'speechSynthesis' in window) {
      const t = i18n.getFixedT(state.language)
      for (const queue of state.queues) {
        if (queue.now_serving && queue.now_serving !== previous.get(queue.queue_id)) {
          const text = queue.now_serving_cabinet
            ? t('tv.announce.calledWithCabinet', {
                number: queue.now_serving,
                cabinet: queue.now_serving_cabinet,
              })
            : t('tv.announce.called', { number: queue.now_serving })
          const utterance = new SpeechSynthesisUtterance(text)
          utterance.lang = SPEECH_LANG[state.language]
          window.speechSynthesis.speak(utterance)
        }
      }
    }

    previousRef.current = current
  }, [state, enabled])
}
