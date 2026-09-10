import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router-dom'

import LanguageSwitcher from '../components/LanguageSwitcher'

export default function Layout() {
  const { t } = useTranslation()

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">{t('app.title')}</span>
        <LanguageSwitcher />
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
