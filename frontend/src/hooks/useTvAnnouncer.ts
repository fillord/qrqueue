import i18n from 'i18next'
import { useEffect, useRef } from 'react'

import type { TvState } from '../api/types'

const SPEECH_LANG: Record<TvState['language'], string> = {
  kk: 'kk-KZ',
  ru: 'ru-RU',
  en: 'en-US',
}

export function useTvAnnouncer(state: TvState | null, enabled: boolean): void {
  const previousRef = useRef<Map<string, number> | null>(null)

  useEffect(() => {
    if (!state) return

    const previous = previousRef.current
    const calls = state.queues.flatMap((q) => q.active_calls)
    const current = new Map(calls.map((call) => [call.ticket_id, call.call_count]))

    if (previous && enabled && 'speechSynthesis' in window) {
      const t = i18n.getFixedT(state.language)
      for (const call of calls) {
        if (call.call_count !== previous.get(call.ticket_id)) {
          const text = call.cabinet_label
            ? t('tv.announce.calledWithCabinet', {
                number: call.display_number,
                cabinet: call.cabinet_label,
              })
            : t('tv.announce.called', { number: call.display_number })
          const utterance = new SpeechSynthesisUtterance(text)
          utterance.lang = SPEECH_LANG[state.language]
          window.speechSynthesis.speak(utterance)
        }
      }
    }

    previousRef.current = current
  }, [state, enabled])
}
