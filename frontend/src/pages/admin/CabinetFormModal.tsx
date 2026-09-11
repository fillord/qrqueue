import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { CabinetCreatePayload } from '../../api/cabinets'
import type { QueueSummary } from '../../api/types'
import Modal from '../../components/Modal'

export default function CabinetFormModal({
  queues,
  onSubmit,
  onClose,
}: {
  queues: QueueSummary[]
  onSubmit: (payload: CabinetCreatePayload) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [label, setLabel] = useState('')
  const [autoCreateQueue, setAutoCreateQueue] = useState(queues.length === 0)
  const [queueId, setQueueId] = useState(queues[0]?.id ?? '')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = label.trim() !== '' && (autoCreateQueue || queueId !== '')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({ label: label.trim(), queue_id: autoCreateQueue ? null : queueId })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={t('admin.cabinets.form.title')} onClose={onClose}>
      <form className="modal-form" onSubmit={(e) => void handleSubmit(e)}>
        <label className="modal__field">
          <span>{t('admin.cabinets.form.label')}</span>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} required />
        </label>

        <div className="modal__field">
          <span>{t('admin.cabinets.form.queue')}</span>
          <label className="modal__radio">
            <input
              type="radio"
              name="cabinet-queue-mode"
              checked={autoCreateQueue}
              onChange={() => setAutoCreateQueue(true)}
            />
            <span>{t('admin.cabinets.form.autoCreateQueue')}</span>
          </label>
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
            <select value={queueId} onChange={(e) => setQueueId(e.target.value)}>
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
