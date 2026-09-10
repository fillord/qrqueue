import { useTranslation } from 'react-i18next'

import { SUPPORTED_LANGUAGES, setLanguage, type SupportedLanguage } from '../app/i18n'

const LABELS: Record<SupportedLanguage, string> = { kk: 'ҚАЗ', ru: 'РУС', en: 'ENG' }

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const current = i18n.language as SupportedLanguage

  return (
    <div className="language-switcher" role="group" aria-label="Language">
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          className={
            lang === current
              ? 'language-switcher__button language-switcher__button--active'
              : 'language-switcher__button'
          }
          onClick={() => setLanguage(lang)}
          aria-pressed={lang === current}
        >
          {LABELS[lang]}
        </button>
      ))}
    </div>
  )
}
