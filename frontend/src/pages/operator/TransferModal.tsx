import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getOperatorQueues } from '../../api/operator'
import type { QueueSummary } from '../../api/types'
import Modal from '../../components/Modal'

export default function TransferModal({
  currentQueueId,
  onConfirm,
  onClose,
}: {
  currentQueueId: string
  onConfirm: (queueId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [queues, setQueues] = useState<QueueSummary[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getOperatorQueues().then((list) => {
      if (!cancelled) setQueues(list.filter((q) => q.id !== currentQueueId))
    })
    return () => {
      cancelled = true
    }
  }, [currentQueueId])

  return (
    <Modal title={t('operator.transferModal.title')} onClose={onClose}>
      {queues === null ? (
        <div className="spinner" aria-hidden="true" />
      ) : queues.length === 0 ? (
        <p>{t('operator.transferModal.empty')}</p>
      ) : (
        <ul className="modal__list">
          {queues.map((queue) => (
            <li key={queue.id}>
              <label className="modal__radio">
                <input
                  type="radio"
                  name="transfer-queue"
                  checked={selected === queue.id}
                  onChange={() => setSelected(queue.id)}
                />
                <span>{queue.name}</span>
                <span className={`operator-select__status operator-select__status--${queue.status === 'open' ? 'free' : 'paused'}`}>
                  {t(`operator.queueStatus.${queue.status}`)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="modal__actions">
        <button type="button" className="modal__cancel" onClick={onClose}>
          {t('operator.transferModal.cancel')}
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && onConfirm(selected)}
        >
          {t('operator.transferModal.confirm')}
        </button>
      </div>
    </Modal>
  )
}
