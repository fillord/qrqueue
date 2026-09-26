import LoadError from '../../components/LoadError'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { getAdminQueues } from '../../api/admin'
import { archiveCabinet, createCabinet, listCabinets, restoreCabinet, updateCabinet } from '../../api/cabinets'
import type { CabinetCreatePayload } from '../../api/cabinets'
import { listStaff } from '../../api/staffAdmin'
import type { Cabinet, CabinetStatus, QueueSummary, StaffUser } from '../../api/types'
import StatusBadge from '../../components/StatusBadge'
import ToastStack from '../../components/ToastStack'
import { useToasts } from '../../hooks/useToasts'
import { apiErrorMessage } from '../../lib/apiError'
import CabinetFormModal from './CabinetFormModal'
import CabinetOperatorsModal from './CabinetOperatorsModal'

const STATUS_TONE: Record<CabinetStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  free: 'success',
  busy: 'warning',
  paused: 'danger',
  offline: 'neutral',
}

export default function AdminCabinetsPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loadError, setLoadError] = useState(false)
  const { toasts, push, dismiss } = useToasts()
  const [cabinets, setCabinets] = useState<Cabinet[] | null>(null)
  const [queues, setQueues] = useState<QueueSummary[]>([])
  const [operators, setOperators] = useState<StaffUser[]>([])
  const [editing, setEditing] = useState<Cabinet | null>(null)
  const [creating, setCreating] = useState(false)
  const [managingOperatorsFor, setManagingOperatorsFor] = useState<Cabinet | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)

  async function load() {
    setLoadError(false)
    try {
    const [cabinetList, queueList, staffList] = await Promise.all([
      listCabinets(includeArchived),
      getAdminQueues(),
      listStaff(),
    ])
    setCabinets(cabinetList)
    setQueues(queueList)
    setOperators(staffList.filter((u) => u.role === 'operator'))
    } catch { setLoadError(true) }
  }

  useEffect(() => {
    void load()
  }, [includeArchived])

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreating(true)
    } else if (searchParams.get('assign') === '1') {
      if (cabinets === null) return
      const cabinet = cabinets.find((item) => item.is_active && !item.deleted_at && item.queue_id)
      if (cabinet) setManagingOperatorsFor(cabinet)
    } else return
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('new')
      next.delete('assign')
      return next
    }, { replace: true })
  }, [searchParams, setSearchParams, cabinets])

  async function handleArchive(cabinet: Cabinet) {
    if (!window.confirm(t('crud.archiveCabinetConfirm', { name: cabinet.label }))) return
    try { await archiveCabinet(cabinet.id); await load() }
    catch (err) { push(apiErrorMessage(err, t)) }
  }

  async function handleRestore(cabinet: Cabinet) {
    try { await restoreCabinet(cabinet.id); push(t('crud.restoreHint')); await load() }
    catch (err) { push(apiErrorMessage(err, t)) }
  }

  async function handleCreate(payload: CabinetCreatePayload) {
    try {
      if (editing) {
        await updateCabinet(editing.id, payload)
        setEditing(null)
      } else await createCabinet(payload)
      setCreating(false)
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  async function toggleActive(cabinet: Cabinet) {
    try { await updateCabinet(cabinet.id, { is_active: !cabinet.is_active }); await load() }
    catch (err) { push(apiErrorMessage(err, t)) }
  }

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1>{t('admin.cabinets.title')}</h1>
        <div className="admin-page__header-actions">
          <button type="button" className="admin-button--secondary" onClick={() => setIncludeArchived(!includeArchived)}>{t(includeArchived ? 'crud.hideArchived' : 'crud.showArchived')}</button>
          <button type="button" onClick={() => setCreating(true)}>{t('admin.cabinets.create')}</button>
        </div>
      </div>

      {cabinets === null ? (
        loadError ? null : <div className="spinner" aria-hidden="true" />
      ) : cabinets.length === 0 ? (
        <p className="admin-page__empty">{t('admin.cabinets.empty')}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.cabinets.columns.label')}</th>
              <th>{t('admin.cabinets.columns.queue')}</th>
              <th>{t('admin.cabinets.columns.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cabinets.map((cabinet) => (
              <tr key={cabinet.id}>
                <td>{cabinet.label}{cabinet.deleted_at ? ` (${t('crud.archived')})` : !cabinet.is_active ? ` (${t('admin.users.inactive')})` : ''}</td>
                <td>{queues.find((q) => q.id === cabinet.queue_id)?.name ?? '—'}</td>
                <td>
                  <StatusBadge tone={cabinet.deleted_at ? 'neutral' : STATUS_TONE[cabinet.status]} label={cabinet.deleted_at ? t('crud.archived') : t(`operator.cabinetStatus.${cabinet.status}`)} />
                </td>
                <td className="admin-table__actions">
                  {cabinet.deleted_at ? <button type="button" onClick={() => void handleRestore(cabinet)}>{t('crud.restore')}</button> : <>
                    <button type="button" onClick={() => setEditing(cabinet)}>{t('admin.common.edit')}</button>
                    <button type="button" disabled={!!cabinet.current_ticket_id} onClick={() => void toggleActive(cabinet)}>{t(cabinet.is_active ? 'admin.users.deactivate' : 'admin.users.activate')}</button>
                    <button type="button" onClick={() => setManagingOperatorsFor(cabinet)}>{t('admin.cabinets.manageOperators')}</button>
                    <button type="button" className="admin-action--danger" onClick={() => void handleArchive(cabinet)}>{t('crud.archive')}</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(creating || editing) && (
        <CabinetFormModal initial={editing ?? undefined} queues={queues} onSubmit={handleCreate} onClose={() => { setCreating(false); setEditing(null) }} />
      )}

      {managingOperatorsFor && (
        <CabinetOperatorsModal
          cabinet={managingOperatorsFor}
          allOperators={operators}
          onClose={() => setManagingOperatorsFor(null)}
        />
      )}

      {loadError && <LoadError retry={() => void load()} />}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
