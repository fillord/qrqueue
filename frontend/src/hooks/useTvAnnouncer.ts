import i18n from 'i18next'
import { useEffect, useRef } from 'react'

import type { TvState } from '../api/types'

const SPEECH_LANG: Record<TvState['language'], string> = {
  kk: 'kk-KZ',
  ru: 'ru-RU',
  en: 'en-US',
}

export function availableTvVoices(language: TvState['language']): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return []
  const prefix = language.toLowerCase()
  return (window.speechSynthesis.getVoices?.() ?? [])
    .filter((voice) => voice.lang.toLowerCase().split(/[-_]/)[0] === prefix)
}

function spokenCabinet(label: string): string {
  const trimmed = label.trim()
  return trimmed.match(/(?:^|[\s№#])(\d+(?:[-/]\d+)?[A-Za-zА-Яа-я]?)$/)?.[1] ?? trimmed
}

export function speakTvAnnouncement(text: string, language: TvState['language'], voiceUri = ''): void {
  if (!('speechSynthesis' in window)) return
  // Some TV speech engines read punctuation literally ("comma", "period").
  const spokenText = text.replace(/[,.!?;:]+/g, ' ').replace(/\s+/g, ' ').trim()
  const utterance = new SpeechSynthesisUtterance(spokenText)
  utterance.lang = SPEECH_LANG[language]
  // Leave the system default untouched unless the user selected a voice.
  // Some TV browsers list voices that cannot actually play on that device.
  if (voiceUri) {
    const voice = availableTvVoices(language).find((item) => item.voiceURI === voiceUri)
    if (voice) utterance.voice = voice
  }
  const synth = window.speechSynthesis
  if (synth.paused) synth.resume()
  synth.speak(utterance)
}

export function useTvAnnouncer(state: TvState | null, enabled: boolean, voiceUri = ''): void {
  const previousRef = useRef<Map<string, number> | null>(null)

  useEffect(() => {
    if (!state) return

    const previous = previousRef.current
    const calls = state.queues.flatMap((q) => q.active_calls)
    const current = new Map(calls.map((call) => [call.ticket_id, call.call_count]))

    if (previous && enabled) {
      const t = i18n.getFixedT(state.language)
      for (const call of calls) {
        if (call.call_count !== previous.get(call.ticket_id)) {
          const text = call.cabinet_label
            ? t('tv.announce.calledWithCabinet', {
                number: call.display_number,
                cabinet: spokenCabinet(call.cabinet_label),
              })
            : t('tv.announce.called', { number: call.display_number })
          speakTvAnnouncement(text, state.language, voiceUri)
        }
      }
    }

    previousRef.current = current
  }, [state, enabled, voiceUri])
}
