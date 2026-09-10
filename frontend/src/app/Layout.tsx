import { useTranslation } from 'react-i18next'
import { Outlet, useNavigate } from 'react-router-dom'

import LanguageSwitcher from '../components/LanguageSwitcher'
import { useAuth } from './AuthContext'

export default function Layout() {
  const { t } = useTranslation()
  const { user, status, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">{t('app.title')}</span>
        <div className="app-header__right">
          {status === 'authenticated' && user && (
            <div className="app-header__auth">
              <span className="app-header__user">{user.full_name}</span>
              <button type="button" onClick={() => void handleLogout()}>
                {t('auth.logout')}
              </button>
            </div>
          )}
          <LanguageSwitcher />
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
