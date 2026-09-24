import { useTranslation } from 'react-i18next'

export default function LoadError({ retry }: { retry: () => void }) {
  const { t } = useTranslation()
  return <div role="alert" className="admin-page__error"><p>{t('admin.errors.unknown')}</p><button type="button" onClick={retry}>{t('admin.common.retry')}</button></div>
}
