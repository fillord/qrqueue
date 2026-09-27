import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'

import DashboardShell from '../../components/DashboardShell'

function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'admin-layout__link admin-layout__link--active' : 'admin-layout__link'
}

// Shared sidebar for /admin/*.
export default function AdminLayout() {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  return (
    <DashboardShell>
        <NavLink to="/admin" end className={linkClass}>{t('admin.nav.home')}</NavLink>
        <details className="admin-layout__nav-group" open={pathname.startsWith('/admin/attendance')}>
          <summary className="admin-layout__nav-heading">{t('admin.nav.attendance')}</summary>
          <div className="admin-layout__nav-items">
            <NavLink to="/admin/attendance" end className={linkClass}>{t('admin.nav.attendanceSummary')}</NavLink>
            <NavLink to="/admin/attendance/employees" className={linkClass}>{t('admin.nav.attendanceEmployees')}</NavLink>
            <NavLink to="/admin/attendance/events" className={linkClass}>{t('admin.nav.attendanceEvents')}</NavLink>
            <NavLink to="/admin/attendance/settings" className={linkClass}>{t('admin.nav.attendanceSettings')}</NavLink>
          </div>
        </details>
        <details className="admin-layout__nav-group" open={pathname === '/admin' || /^\/admin\/(problems|queues|cabinets|users)(\/|$)/.test(pathname)}>
          <summary className="admin-layout__nav-heading">{t('admin.nav.groups.work')}</summary>
          <div className="admin-layout__nav-items">
          <NavLink to="/admin/problems" className={linkClass}>{t('admin.nav.problems')}</NavLink>
          <NavLink to="/admin/queues" className={linkClass}>
            {t('admin.nav.queues')}
          </NavLink>
          <NavLink to="/admin/cabinets" className={linkClass}>
            {t('admin.nav.cabinets')}
          </NavLink>
          <NavLink to="/admin/users" className={linkClass}>
            {t('admin.nav.staff')}
          </NavLink>
          </div>
        </details>
        <details className="admin-layout__nav-group" open={/^\/admin\/(tv-screens|signage)(\/|$)/.test(pathname)}>
          <summary className="admin-layout__nav-heading">{t('admin.nav.groups.screens')}</summary>
          <div className="admin-layout__nav-items">
          <NavLink to="/admin/tv-screens" className={linkClass}>
            {t('admin.nav.tvScreens')}
          </NavLink>
          <NavLink to="/admin/signage" className={linkClass}>
            {t('admin.nav.signage')}
          </NavLink>
          </div>
        </details>
        <details className="admin-layout__nav-group" open={/^\/admin\/(daily-report|analytics|audit-logs)(\/|$)/.test(pathname)}>
          <summary className="admin-layout__nav-heading">{t('admin.nav.groups.reports')}</summary>
          <div className="admin-layout__nav-items">
          <NavLink to="/admin/daily-report" className={linkClass}>{t('admin.nav.dailyReport')}</NavLink>
          <NavLink to="/admin/analytics" className={linkClass}>{t('admin.nav.analytics')}</NavLink>
          <NavLink to="/admin/audit-logs" className={linkClass}>{t('admin.nav.auditLogs')}</NavLink>
          </div>
        </details>
        <details className="admin-layout__nav-group" open={pathname.startsWith('/admin/organization')}>
          <summary className="admin-layout__nav-heading">{t('admin.nav.groups.settings')}</summary>
          <div className="admin-layout__nav-items">
          <NavLink to="/admin/organization" className={linkClass}>{t('admin.nav.organization')}</NavLink>
          </div>
        </details>
    </DashboardShell>
  )
}
