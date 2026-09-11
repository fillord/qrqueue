import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'admin-layout__link admin-layout__link--active' : 'admin-layout__link'
}

/** Minimal tab nav for /sa/* — just the two pages this step adds. Org/admin
 * management (already reachable via the API from step 1/2) doesn't get a
 * frontend here, that's out of scope for this step. */
export default function SaLayout() {
  const { t } = useTranslation()

  return (
    <div className="admin-layout">
      <nav className="admin-layout__sidebar">
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
