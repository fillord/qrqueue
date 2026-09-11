import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { QueueCreatePayload, QueueUpdatePayload } from '../../api/queues'
import type { AdminQueue } from '../../api/types'
import Modal from '../../components/Modal'
import { geoFieldsValid } from '../../lib/geoValidation'

export default function QueueFormModal({
  queue,
  onSubmit,
  onClose,
}: {
  queue: AdminQueue | null
  onSubmit: (payload: QueueCreatePayload | QueueUpdatePayload) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(queue?.name ?? '')
  const [ticketPrefix, setTicketPrefix] = useState(queue?.ticket_prefix ?? '')
  const [latitude, setLatitude] = useState(queue?.latitude != null ? String(queue.latitude) : '')
  const [longitude, setLongitude] = useState(queue?.longitude != null ? String(queue.longitude) : '')
  const [geoRadiusM, setGeoRadiusM] = useState(queue?.geo_radius_m != null ? String(queue.geo_radius_m) : '')
  const [presenceTimeoutMin, setPresenceTimeoutMin] = useState(
    queue?.presence_timeout_min != null ? String(queue.presence_timeout_min) : '',
  )
  const [dailyTicketLimit, setDailyTicketLimit] = useState(
    queue?.daily_ticket_limit != null ? String(queue.daily_ticket_limit) : '',
  )
  const [submitting, setSubmitting] = useState(false)

  const geoValid = geoFieldsValid(latitude, longitude, geoRadiusM)
  const canSubmit = name.trim() !== '' && ticketPrefix.trim() !== '' && geoValid

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const hasGeo = latitude.trim() !== ''
      await onSubmit({
        name: name.trim(),
        ticket_prefix: ticketPrefix.trim(),
        latitude: hasGeo ? Number(latitude) : null,
        longitude: hasGeo ? Number(longitude) : null,
        geo_radius_m: hasGeo ? Number(geoRadiusM) : null,
        // presence_timeout_min is NOT NULL in the DB — omitting it (rather than sending
        // null) leaves it unchanged on edit / lets the backend default apply on create.
        ...(presenceTimeoutMin.trim() !== '' ? { presence_timeout_min: Number(presenceTimeoutMin) } : {}),
        daily_ticket_limit: dailyTicketLimit.trim() === '' ? null : Number(dailyTicketLimit),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={queue ? t('admin.queues.form.editTitle') : t('admin.queues.form.createTitle')}
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={(e) => void handleSubmit(e)}>
        <label className="modal__field">
          <span>{t('admin.queues.form.name')}</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <label className="modal__field">
          <span>{t('admin.queues.form.ticketPrefix')}</span>
          <input
            type="text"
            value={ticketPrefix}
            maxLength={4}
            onChange={(e) => setTicketPrefix(e.target.value.toUpperCase())}
            required
          />
        </label>

        <fieldset className="modal-form__fieldset">
          <legend>{t('admin.queues.form.geoLegend')}</legend>
          <label className="modal__field">
            <span>{t('admin.queues.form.latitude')}</span>
            <input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
            />
          </label>
          <label className="modal__field">
            <span>{t('admin.queues.form.longitude')}</span>
            <input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
            />
          </label>
          <label className="modal__field">
            <span>{t('admin.queues.form.geoRadiusM')}</span>
            <input
              type="number"
              step="1"
              min="1"
              value={geoRadiusM}
              onChange={(e) => setGeoRadiusM(e.target.value)}
            />
          </label>
          {!geoValid && <p className="modal-form__error">{t('admin.queues.form.geoError')}</p>}
        </fieldset>

        <label className="modal__field">
          <span>{t('admin.queues.form.presenceTimeoutMin')}</span>
          <input
            type="number"
            step="1"
            min="1"
            value={presenceTimeoutMin}
            onChange={(e) => setPresenceTimeoutMin(e.target.value)}
            placeholder={t('admin.queues.form.presenceTimeoutMinPlaceholder')}
          />
        </label>

        <label className="modal__field">
          <span>{t('admin.queues.form.dailyTicketLimit')}</span>
          <input
            type="number"
            step="1"
            min="1"
            value={dailyTicketLimit}
            onChange={(e) => setDailyTicketLimit(e.target.value)}
            placeholder={t('admin.queues.form.dailyTicketLimitPlaceholder')}
          />
        </label>

        <div className="modal__actions">
          <button type="button" className="modal__cancel" onClick={onClose}>
            {t('admin.queues.form.cancel')}
          </button>
          <button type="submit" disabled={!canSubmit || submitting}>
            {t('admin.queues.form.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
