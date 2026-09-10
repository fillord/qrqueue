import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../components/Modal'

export default function PauseModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (reason: string | undefined) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')

  return (
    <Modal title={t('operator.pauseModal.title')} onClose={onClose}>
      <label className="modal__field">
        <span>{t('operator.pauseModal.reasonLabel')}</span>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>

      <div className="modal__actions">
        <button type="button" className="modal__cancel" onClick={onClose}>
          {t('operator.pauseModal.cancel')}
        </button>
        <button type="button" onClick={() => onConfirm(reason.trim() || undefined)}>
          {t('operator.pauseModal.confirm')}
        </button>
      </div>
    </Modal>
  )
}
