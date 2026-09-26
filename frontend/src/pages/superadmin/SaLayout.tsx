import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'

import DashboardShell from '../../components/DashboardShell'

function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'admin-layout__link admin-layout__link--active' : 'admin-layout__link'
}

// Sidebar for /sa/*.
export default function SaLayout() {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  return (
    <DashboardShell>
        <details className="admin-layout__nav-group" open={!/^\/sa\/(analytics|audit-logs)(\/|$)/.test(pathname)}>
          <summary className="admin-layout__nav-heading">{t('admin.nav.groups.management')}</summary>
          <div className="admin-layout__nav-items">
            <NavLink to="/sa/organizations" className={linkClass}>{t('admin.saOrganizations.title')}</NavLink>
            <NavLink to="/sa/users" className={linkClass}>{t('directory.users')}</NavLink>
            <NavLink to="/sa/trial-requests" className={linkClass}>{t('admin.trials.title')}</NavLink>
          </div>
        </details>
        <details className="admin-layout__nav-group" open={/^\/sa\/(analytics|audit-logs)(\/|$)/.test(pathname)}>
          <summary className="admin-layout__nav-heading">{t('admin.nav.groups.reports')}</summary>
          <div className="admin-layout__nav-items">
            <NavLink to="/sa/analytics" className={linkClass}>{t('admin.nav.analytics')}</NavLink>
            <NavLink to="/sa/audit-logs" className={linkClass}>{t('admin.nav.auditLogs')}</NavLink>
          </div>
        </details>
    </DashboardShell>
  )
}
