import { useTranslation } from 'react-i18next'

export default function InDevelopmentPage({ note }: { note?: string }) {
  const { t } = useTranslation()

  return (
    <div className="placeholder-page">
      <h1>{t('placeholder.title')}</h1>
      <p>{t('placeholder.message')}</p>
      {note && <p className="placeholder-page__note">{note}</p>}
    </div>
  )
}
