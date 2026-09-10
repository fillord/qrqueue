import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { getCabinets, selectCabinet } from '../../api/operator'
import type { Cabinet } from '../../api/types'
import { getRememberedCabinetId, rememberCabinetId } from '../../lib/operatorCabinet'

/**
 * /operator — cabinet picker. A single assigned cabinet, or one already
 * remembered from a previous session, is re-selected automatically (the
 * Redis selection key has a TTL and may have expired) so the operator lands
 * straight on /operator/queue instead of clicking through every time.
 */
export default function CabinetSelectPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [cabinets, setCabinets] = useState<Cabinet[] | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [error, setError] = useState(false)

  const goToQueue = useCallback(
    async (cabinetId: string) => {
      setSelectingId(cabinetId)
      setError(false)
      try {
        await selectCabinet(cabinetId)
        rememberCabinetId(cabinetId)
        navigate('/operator/queue')
      } catch {
        setError(true)
        setSelectingId(null)
      }
    },
    [navigate],
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const list = await getCabinets()
        if (cancelled) return
        setCabinets(list)

        if (list.length === 1) {
          void goToQueue(list[0].id)
          return
        }

        const remembered = getRememberedCabinetId()
        if (remembered && list.some((c) => c.id === remembered)) {
          void goToQueue(remembered)
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [goToQueue])

  if (cabinets === null || selectingId) {
    return (
      <div className="operator-select">
        <div className="spinner" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="operator-select">
      <h1 className="operator-select__title">{t('operator.cabinetSelect.title')}</h1>

      {error && <p className="operator-select__error">{t('operator.errors.unknown_error')}</p>}

      {cabinets.length === 0 ? (
        <p>{t('operator.cabinetSelect.empty')}</p>
      ) : (
        <div className="operator-select__grid">
          {cabinets.map((cabinet) => (
            <button
              key={cabinet.id}
              type="button"
              className="operator-select__card"
              onClick={() => void goToQueue(cabinet.id)}
            >
              <span className="operator-select__label">{cabinet.label}</span>
              <span className={`operator-select__status operator-select__status--${cabinet.status}`}>
                {t(`operator.cabinetStatus.${cabinet.status}`)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
