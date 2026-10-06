import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import kk from './locales/kk.json'
import ru from './locales/ru.json'
import { workforce } from './locales/workforce'

export const SUPPORTED_LANGUAGES = ['kk', 'ru', 'en'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

const STORAGE_KEY = 'queue.language'
const DEFAULT_LANGUAGE: SupportedLanguage = 'ru'

function isSupportedLanguage(value: string | null): value is SupportedLanguage {
  return value !== null && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

function readStoredLanguage(): SupportedLanguage | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isSupportedLanguage(stored) ? stored : null
  } catch {
    return null
  }
}

function detectLanguage(): SupportedLanguage {
  const stored = readStoredLanguage()
  if (stored) return stored

  const browserLang = navigator.language?.slice(0, 2).toLowerCase() ?? null
  if (isSupportedLanguage(browserLang)) return browserLang

  return DEFAULT_LANGUAGE
}

const initialLanguage = detectLanguage()

void i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: { ...ru, workforce: workforce.ru } },
    kk: { translation: { ...kk, workforce: workforce.kk } },
    en: { translation: { ...en, workforce: workforce.en } },
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
})

document.documentElement.lang = initialLanguage
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
})

export function setLanguage(lang: SupportedLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // ignore — language will just not persist across visits
  }
  void i18n.changeLanguage(lang)
}

export default i18n
