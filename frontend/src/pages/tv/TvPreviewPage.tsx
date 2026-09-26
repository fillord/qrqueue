import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getTvScreenPreview } from '../../api/admin'
import type { TvState } from '../../api/types'
import { TvDisplay } from './TvPage'

export default function TvPreviewPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const organizationId = params.get('organization_id') || undefined
  const { t, i18n } = useTranslation()
  const [state, setState] = useState<TvState | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!id) return
    let active = true
    const refresh = () => void getTvScreenPreview(id, organizationId)
      .then((next) => { if (active) { setState(next); setError(false) } })
      .catch(() => { if (active) setError(true) })
    refresh()
    const timer = window.setInterval(refresh, 15_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [id, organizationId])

  useEffect(() => { if (state) void i18n.changeLanguage(state.language) }, [state?.language, i18n])

  return <div className="tv-preview-page">
    {state ? <TvDisplay state={state} preview /> : <div className="tv-screen tv-screen--loading">{error ? t('adminTv.preview.error') : <div className="spinner" aria-hidden="true" />}</div>}
    <span className="tv-preview-page__badge">{t('adminTv.preview.badge')}</span>
  </div>
}
