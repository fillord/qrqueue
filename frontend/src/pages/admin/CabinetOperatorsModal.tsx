import LoadError from '../../components/LoadError'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { assignCabinetOperator, listCabinetOperators, unassignCabinetOperator } from '../../api/cabinets'
import type { Cabinet, StaffUser } from '../../api/types'
import Modal from '../../components/Modal'
import { apiErrorMessage } from '../../lib/apiError'

export default function CabinetOperatorsModal({
  cabinet,
  allOperators,
  onClose,
}: {
  cabinet: Cabinet
  allOperators: StaffUser[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [loadError, setLoadError] = useState(false)
  const [assigned, setAssigned] = useState<StaffUser[] | null>(null)
  const [addingId, setAddingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoadError(false)
    try {
    setAssigned(await listCabinetOperators(cabinet.id))
    } catch { setLoadError(true) }
  }

  useEffect(() => {
    void load()
  }, [])

  const assignedIds = new Set((assigned ?? []).map((u) => u.id))
  const availableToAdd = allOperators.filter((op) => op.is_active && !assignedIds.has(op.id))

  async function handleAdd() {
    if (!addingId) return
    setBusy(true)
    setError(null)
    try {
      await assignCabinetOperator(cabinet.id, addingId)
      setAddingId('')
      await load()
    } catch (err) {
      setError(apiErrorMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(userId: string) {
    setBusy(true)
    setError(null)
    try {
      await unassignCabinetOperator(cabinet.id, userId)
      await load()
    } catch (err) {
      setError(apiErrorMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('admin.cabinets.operatorsModal.title', { label: cabinet.label })} onClose={onClose}>
      {assigned === null ? (
        loadError ? null : <div className="spinner" aria-hidden="true" />
      ) : assigned.length === 0 ? (
        <p className="admin-page__empty">{t('admin.cabinets.operatorsModal.empty')}</p>
      ) : (
        <ul className="modal__list">
          {assigned.map((operator) => (
            <li key={operator.id} className="admin-cabinets__operator-row">
              <span>{operator.full_name}</span>
              <button type="button" disabled={busy} onClick={() => void handleRemove(operator.id)}>
                {t('admin.cabinets.operatorsModal.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="admin-cabinets__operator-add">
        <select value={addingId} onChange={(e) => setAddingId(e.target.value)} disabled={availableToAdd.length === 0}>
          <option value="">{t('admin.cabinets.operatorsModal.selectOperator')}</option>
          {availableToAdd.map((operator) => (
            <option key={operator.id} value={operator.id}>
              {operator.full_name}
            </option>
          ))}
        </select>
        <button type="button" disabled={!addingId || busy} onClick={() => void handleAdd()}>
          {t('admin.cabinets.operatorsModal.add')}
        </button>
      </div>

      {loadError && <LoadError retry={() => void load()} />}
      {error && <p className="admin-page__error">{error}</p>}

      <div className="modal__actions">
        <button type="button" className="modal__cancel" onClick={onClose}>
          {t('admin.cabinets.operatorsModal.close')}
        </button>
      </div>
    </Modal>
  )
}
