import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPatch } from '../../api/client'
import { apiErrorMessage } from '../../lib/apiError'

type TrialRequest = { id: string; name: string; organization: string; contact: string; processed: boolean; created_at: string }
const PAGE_SIZE = 50

export default function SaTrialRequestsPage() {
  const { t, i18n } = useTranslation()
  const [entries, setEntries] = useState<TrialRequest[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    apiGet<TrialRequest[]>(`/api/sa/trial-requests?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`)
      .then((data) => { if (!cancelled) setEntries(data) })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, t)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page, revision, t])
  async function toggle(entry: TrialRequest) {
    setBusy(entry.id)
    setError('')
    try {
      const updated = await apiPatch<TrialRequest>(`/api/sa/trial-requests/${entry.id}`, { processed: !entry.processed })
      setEntries((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch (err) { setError(apiErrorMessage(err, t)) }
    finally { setBusy(null) }
  }
  return <div className="admin-page">
    <div className="admin-page__header"><h1>{t('admin.trials.title')}</h1><button onClick={() => setRevision((n) => n + 1)} disabled={loading}>{t('admin.trials.refresh')}</button></div>
    {error && <p role="alert">{error}</p>}
    {loading ? <div className="spinner" /> : <>
      {!entries.length ? <p>{t('admin.trials.empty')}</p> : <table className="admin-table">
        <thead><tr>{['date', 'name', 'organization', 'contact', 'status'].map((key) => <th key={key}>{t(`admin.trials.${key}`)}</th>)}<th /></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id}>
          <td>{new Date(entry.created_at).toLocaleString(i18n.language)}</td><td>{entry.name}</td><td>{entry.organization}</td><td>{entry.contact}</td>
          <td>{t(entry.processed ? 'admin.trials.processed' : 'admin.trials.new')}</td>
          <td><button disabled={busy !== null} onClick={() => void toggle(entry)}>{t(entry.processed ? 'admin.trials.reopen' : 'admin.trials.complete')}</button></td>
        </tr>)}</tbody>
      </table>}
      <div className="admin-page__header">
        <button disabled={page === 0} onClick={() => setPage((n) => n - 1)}>{t('admin.trials.previous')}</button>
        <span>{page + 1}</span><button disabled={entries.length < PAGE_SIZE} onClick={() => setPage((n) => n + 1)}>{t('admin.trials.next')}</button>
      </div>
    </>}
  </div>
}
