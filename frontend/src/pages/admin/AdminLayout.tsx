import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'admin-layout__link admin-layout__link--active' : 'admin-layout__link'
}

/**
 * Shared sidebar for /admin/* — the real admin panel this step introduces.
 * Queues/Cabinets/Staff aren't built yet (step 9), so those links point at
 * the generic placeholder for now; they're wired in already so the nav
 * doesn't need to change shape when that work lands.
 */
export default function AdminLayout() {
  const { t } = useTranslation()

  return (
    <div className="admin-layout">
      <nav className="admin-layout__sidebar">
        <NavLink to="/admin/analytics" className={linkClass}>
          {t('admin.nav.analytics')}
        </NavLink>
        <NavLink to="/admin/audit-logs" className={linkClass}>
          {t('admin.nav.auditLogs')}
        </NavLink>
        <NavLink to="/admin/organization" className={linkClass}>
          {t('admin.nav.organization')}
        </NavLink>
        <NavLink to="/admin/queues" className={linkClass}>
          {t('admin.nav.queues')}
        </NavLink>
        <NavLink to="/admin/cabinets" className={linkClass}>
          {t('admin.nav.cabinets')}
        </NavLink>
        <NavLink to="/admin/staff" className={linkClass}>
          {t('admin.nav.staff')}
        </NavLink>
        <NavLink to="/admin/tv-screens" className={linkClass}>
          {t('admin.nav.tvScreens')}
        </NavLink>
      </nav>
      <div className="admin-layout__content">
        <Outlet />
      </div>
    </div>
  )
}
