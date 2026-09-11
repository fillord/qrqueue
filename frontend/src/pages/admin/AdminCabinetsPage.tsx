import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getAdminQueues } from '../../api/admin'
import { createCabinet, listCabinets } from '../../api/cabinets'
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
  const { toasts, push, dismiss } = useToasts()
  const [cabinets, setCabinets] = useState<Cabinet[] | null>(null)
  const [queues, setQueues] = useState<QueueSummary[]>([])
  const [operators, setOperators] = useState<StaffUser[]>([])
  const [creating, setCreating] = useState(false)
  const [managingOperatorsFor, setManagingOperatorsFor] = useState<Cabinet | null>(null)

  async function load() {
    const [cabinetList, queueList, staffList] = await Promise.all([
      listCabinets(),
      getAdminQueues(),
      listStaff(),
    ])
    setCabinets(cabinetList)
    setQueues(queueList)
    setOperators(staffList.filter((u) => u.role === 'operator'))
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleCreate(payload: CabinetCreatePayload) {
    try {
      await createCabinet(payload)
      setCreating(false)
    } catch (err) {
      push(apiErrorMessage(err, t))
    } finally {
      await load()
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1>{t('admin.cabinets.title')}</h1>
        <button type="button" onClick={() => setCreating(true)}>
          {t('admin.cabinets.create')}
        </button>
      </div>

      {cabinets === null ? (
        <div className="spinner" aria-hidden="true" />
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
                <td>{cabinet.label}</td>
                <td>{queues.find((q) => q.id === cabinet.queue_id)?.name ?? '—'}</td>
                <td>
                  <StatusBadge tone={STATUS_TONE[cabinet.status]} label={t(`operator.cabinetStatus.${cabinet.status}`)} />
                </td>
                <td className="admin-table__actions">
                  <button type="button" onClick={() => setManagingOperatorsFor(cabinet)}>
                    {t('admin.cabinets.manageOperators')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && (
        <CabinetFormModal queues={queues} onSubmit={handleCreate} onClose={() => setCreating(false)} />
      )}

      {managingOperatorsFor && (
        <CabinetOperatorsModal
          cabinet={managingOperatorsFor}
          allOperators={operators}
          onClose={() => setManagingOperatorsFor(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
