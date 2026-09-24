import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router-dom'

const MENU_STORAGE_KEY = 'queue.dashboard.menuOpen'

function initialMenuOpen(): boolean {
  try { return window.localStorage.getItem(MENU_STORAGE_KEY) !== 'false' }
  catch { return true }
}

export default function DashboardShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(initialMenuOpen)

  useEffect(() => {
    try { window.localStorage.setItem(MENU_STORAGE_KEY, String(menuOpen)) }
    catch { /* Dashboard navigation still works when storage is unavailable. */ }
  }, [menuOpen])

  return <div className="admin-layout">
    <nav id="dashboard-navigation" className="admin-layout__sidebar" aria-label={t('dashboard.navigation')} hidden={!menuOpen}>
      {children}
    </nav>
    <div className="admin-layout__content">
      <div className="admin-layout__toolbar">
        <button type="button" className="admin-layout__menu-toggle" aria-controls="dashboard-navigation"
          aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          {t(menuOpen ? 'dashboard.hideMenu' : 'dashboard.showMenu')}
        </button>
      </div>
      <Outlet />
    </div>
  </div>
}
