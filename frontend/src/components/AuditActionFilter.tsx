import { useTranslation } from 'react-i18next'

import { AUDIT_ACTIONS, auditActionLabel, auditEntityLabel } from '../lib/auditLogPresentation'

interface Props {
  value: string
  onChange: (value: string) => void
}

export default function AuditActionFilter({ value, onChange }: Props) {
  const { t } = useTranslation()

  return (
    <label>
      <span>{t('admin.auditLog.action')}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('admin.auditLog.allActions')}</option>
        {Object.entries(AUDIT_ACTIONS).map(([entity, actions]) => (
          <optgroup key={entity} label={auditEntityLabel(t, entity)}>
            {actions.map((verb) => {
              const code = `${entity}.${verb}`
              return <option key={code} value={code}>{auditActionLabel(t, code)}</option>
            })}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
