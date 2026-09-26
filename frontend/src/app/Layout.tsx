import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import LanguageSwitcher from '../components/LanguageSwitcher'
import { useAuth } from './AuthContext'

export default function Layout() {
  const { t } = useTranslation()
  const { user, status, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isLanding = pathname === '/'

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <header className={`app-header${isLanding ? ' app-header--landing' : ''}`}>
        <Link className="app-header__brand" to="/" aria-label={`OmniBook — ${t('app.title')}`}>
          <span className="app-header__brand-mark" aria-hidden="true">+</span>
          <span className="app-header__brand-name">omni<span>book</span></span>
        </Link>
        {isLanding && <nav className="app-header__landing-nav" aria-label={t('dashboard.navigation')}>
          <a href="#how-it-works">{t('landing.hero.ctaSecondary')}</a>
          <a href="#cta-form">{t('landing.segments.title')}</a>
        </nav>}
        <div className="app-header__right">
          {status === 'authenticated' && user && (
            <div className="app-header__auth">
              <span className="app-header__user">{user.full_name}</span>
              <button type="button" onClick={() => void handleLogout()}>
                {t('auth.logout')}
              </button>
            </div>
          )}
          {isLanding && status !== 'authenticated' && <Link className="app-header__staff-link" to="/login">{t('landing.footer.staffLogin')}</Link>}
          <LanguageSwitcher />
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
