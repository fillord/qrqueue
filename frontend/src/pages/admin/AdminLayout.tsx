import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import DashboardShell from '../../components/DashboardShell'

function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'admin-layout__link admin-layout__link--active' : 'admin-layout__link'
}

// Shared sidebar for /admin/*.
export default function AdminLayout() {
  const { t } = useTranslation()

  return (
    <DashboardShell>
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
        <NavLink to="/admin/users" className={linkClass}>
          {t('admin.nav.staff')}
        </NavLink>
        <NavLink to="/admin/tv-screens" className={linkClass}>
          {t('admin.nav.tvScreens')}
        </NavLink>
        <NavLink to="/admin/signage" className={linkClass}>
          {t('signage.title')}
        </NavLink>
    </DashboardShell>
  )
}
