import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { CabinetCreatePayload } from '../../api/cabinets'
import type { Cabinet, QueueSummary } from '../../api/types'
import Modal from '../../components/Modal'

export default function CabinetFormModal({
  initial,
  queues,
  onSubmit,
  onClose,
}: {
  initial?: Cabinet
  queues: QueueSummary[]
  onSubmit: (payload: CabinetCreatePayload) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [label, setLabel] = useState(initial?.label ?? '')
  const [autoCreateQueue, setAutoCreateQueue] = useState(!initial && queues.length === 0)
  const [queueId, setQueueId] = useState(initial?.queue_id ?? queues[0]?.id ?? '')
  const [submitting, setSubmitting] = useState(false)

  // The queue list can arrive after this modal opens. Match the selected ID to
  // the first visible option instead of leaving a hidden empty value behind.
  const selectedQueueId = queueId || queues[0]?.id || ''
  const canSubmit = label.trim() !== '' && (autoCreateQueue || selectedQueueId !== '')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({ label: label.trim(), queue_id: autoCreateQueue ? null : selectedQueueId })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={t(initial ? 'admin.common.edit' : 'admin.cabinets.form.title')} onClose={onClose}>
      <form className="modal-form" onSubmit={(e) => void handleSubmit(e)}>
        <label className="modal__field">
          <span>{t('admin.cabinets.form.label')}</span>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} required />
        </label>

        <div className="modal__field">
          <span>{t('admin.cabinets.form.queue')}</span>
          {!initial && <label className="modal__radio">
            <input
              type="radio"
              name="cabinet-queue-mode"
              checked={autoCreateQueue}
              onChange={() => setAutoCreateQueue(true)}
            />
            <span>{t('admin.cabinets.form.autoCreateQueue')}</span>
          </label>}
          <label className="modal__radio">
            <input
              type="radio"
              name="cabinet-queue-mode"
              checked={!autoCreateQueue}
              onChange={() => setAutoCreateQueue(false)}
              disabled={queues.length === 0}
            />
            <span>{t('admin.cabinets.form.existingQueue')}</span>
          </label>
          {!autoCreateQueue && (
            <select value={selectedQueueId} onChange={(e) => setQueueId(e.target.value)}>
              {queues.map((queue) => (
                <option key={queue.id} value={queue.id}>
                  {queue.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="modal__actions">
          <button type="button" className="modal__cancel" onClick={onClose}>
            {t('admin.cabinets.form.cancel')}
          </button>
          <button type="submit" disabled={!canSubmit || submitting}>
            {t('admin.cabinets.form.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
