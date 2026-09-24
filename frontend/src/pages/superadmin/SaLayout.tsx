import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import DashboardShell from '../../components/DashboardShell'

function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'admin-layout__link admin-layout__link--active' : 'admin-layout__link'
}

// Sidebar for /sa/*.
export default function SaLayout() {
  const { t } = useTranslation()

  return (
    <DashboardShell>
        <NavLink to="/sa/organizations" className={linkClass}>
          {t('admin.saOrganizations.title')}
        </NavLink>
        <NavLink to="/sa/users" className={linkClass}>{t('directory.users')}</NavLink>
        <NavLink to="/sa/trial-requests" className={linkClass}>{t('admin.trials.title')}</NavLink>
        <NavLink to="/sa/analytics" className={linkClass}>
          {t('admin.nav.analytics')}
        </NavLink>
        <NavLink to="/sa/audit-logs" className={linkClass}>
          {t('admin.nav.auditLogs')}
        </NavLink>
    </DashboardShell>
  )
}
