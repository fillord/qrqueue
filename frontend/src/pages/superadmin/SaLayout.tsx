import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'admin-layout__link admin-layout__link--active' : 'admin-layout__link'
}

// Sidebar for /sa/*.
export default function SaLayout() {
  const { t } = useTranslation()

  return (
    <div className="admin-layout">
      <nav className="admin-layout__sidebar">
        <NavLink to="/sa/organizations" className={linkClass}>
          {t('admin.saOrganizations.title')}
        </NavLink>
        <NavLink to="/sa/analytics" className={linkClass}>
          {t('admin.nav.analytics')}
        </NavLink>
        <NavLink to="/sa/audit-logs" className={linkClass}>
          {t('admin.nav.auditLogs')}
        </NavLink>
      </nav>
      <div className="admin-layout__content">
        <Outlet />
      </div>
    </div>
  )
}
