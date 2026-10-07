import SaUsersPage from '../pages/superadmin/SaUsersPage'
import SaTrialRequestsPage from '../pages/superadmin/SaTrialRequestsPage'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import AdminAnalyticsPage from '../pages/admin/AdminAnalyticsPage'
import AdminAuditLogPage from '../pages/admin/AdminAuditLogPage'
import AdminCabinetsPage from '../pages/admin/AdminCabinetsPage'
import AdminHomePage from '../pages/admin/AdminHomePage'
import AdminProblemsPage from '../pages/admin/AdminProblemsPage'
import AdminDailyReportPage from '../pages/admin/AdminDailyReportPage'
import AdminLayout from '../pages/admin/AdminLayout'
import AdminOrganizationPage from '../pages/admin/AdminOrganizationPage'
import AdminQueueSchedulePage from '../pages/admin/AdminQueueSchedulePage'
import AdminQueuesPage from '../pages/admin/AdminQueuesPage'
import AdminTvScreensPage from '../pages/admin/AdminTvScreensPage'
import AdminUsersPage from '../pages/admin/AdminUsersPage'
import AdminAttendancePage from '../pages/admin/AdminAttendancePage'
import AdminAttendanceDepartmentsPage from '../pages/admin/AdminAttendanceDepartmentsPage'
import AdminWorkforcePage from '../pages/admin/AdminWorkforcePage'
import AttendanceKioskPage from '../pages/attendance/AttendanceKioskPage'
import AttendancePhonePage from '../pages/attendance/AttendancePhonePage'
import AttendanceEnrollPage from '../pages/attendance/AttendanceEnrollPage'
import LandingPage from '../pages/landing/LandingPage'
import LoginPage from '../pages/login/LoginPage'
import ProfilePage from '../pages/profile/ProfilePage'
import CabinetSelectPage from '../pages/operator/CabinetSelectPage'
import OperatorQueuePage from '../pages/operator/OperatorQueuePage'
import RegistrarPage from '../pages/registrar/RegistrarPage'
import ScanPage from '../pages/scan/ScanPage'
import SaAnalyticsPage from '../pages/superadmin/SaAnalyticsPage'
import SaAuditLogPage from '../pages/superadmin/SaAuditLogPage'
import SaLayout from '../pages/superadmin/SaLayout'
import SaOrganizationDetailPage from '../pages/superadmin/SaOrganizationDetailPage'
import SaOrganizationsPage from '../pages/superadmin/SaOrganizationsPage'
import TicketPage from '../pages/ticket/TicketPage'
import TvPage from '../pages/tv/TvPage'
import TvPreviewPage from '../pages/tv/TvPreviewPage'
import TvPairPage from '../pages/tv/TvPairPage'
import Layout from './Layout'
import ProtectedRoute from './ProtectedRoute'

const AdminSignagePage = lazy(() => import('../pages/admin/AdminSignagePage'))
const AdminQueueKiosksPage = lazy(() => import('../pages/admin/AdminQueueKiosksPage'))
const QueueKioskPage = lazy(() => import('../pages/kiosk/QueueKioskPage'))

export default function AppRouter() {
  return (
    <Routes>
      {/* TV screens run fullscreen, chrome-free — no shared app header. */}
      <Route path="/tv/pair" element={<TvPairPage />} />
      <Route path="/tv" element={<TvPage />} />
      <Route path="/tv/preview/:id" element={<ProtectedRoute role={['org_admin', 'superadmin']}><TvPreviewPage /></ProtectedRoute>} />
      <Route path="/attendance/kiosk" element={<AttendanceKioskPage />} />
      <Route path="/kiosk" element={<Suspense fallback={<div className="spinner" />}><QueueKioskPage /></Suspense>} />

      <Route element={<Layout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/q" element={<ScanPage />} />
        <Route path="/t/:id" element={<TicketPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/profile" element={<ProtectedRoute role={['superadmin', 'org_admin', 'operator', 'registrar']}><ProfilePage /></ProtectedRoute>} />
        <Route path="/attendance/phone" element={<AttendancePhonePage />} />
        <Route path="/attendance/enroll" element={<AttendanceEnrollPage />} />
        <Route
          path="/operator"
          element={
            <ProtectedRoute role="operator">
              <CabinetSelectPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/operator/queue"
          element={
            <ProtectedRoute role="operator">
              <OperatorQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/registrar"
          element={
            <ProtectedRoute role="registrar">
              <RegistrarPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute role="org_admin">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminHomePage />} />
          <Route path="problems" element={<AdminProblemsPage />} />
          <Route path="daily-report" element={<AdminDailyReportPage />} />
          <Route path="analytics" element={<AdminAnalyticsPage />} />
          <Route path="audit-logs" element={<AdminAuditLogPage />} />
          <Route path="organization" element={<AdminOrganizationPage />} />
          <Route path="queues" element={<AdminQueuesPage />} />
          <Route path="queue-kiosks" element={<Suspense fallback={<div className="spinner" />}><AdminQueueKiosksPage /></Suspense>} />
          <Route path="queues/:id/schedule" element={<AdminQueueSchedulePage />} />
          <Route path="cabinets" element={<AdminCabinetsPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="attendance" element={<AdminAttendancePage section="summary" />} />
          <Route path="attendance/departments" element={<AdminAttendanceDepartmentsPage />} />
          <Route path="attendance/employees" element={<AdminAttendancePage section="employees" />} />
          <Route path="attendance/events" element={<AdminAttendancePage section="events" />} />
          <Route path="attendance/settings" element={<AdminAttendancePage section="settings" />} />
          <Route path="attendance/calendar" element={<AdminWorkforcePage mode="calendar" />} />
          <Route path="attendance/timesheet" element={<AdminWorkforcePage mode="timesheet" />} />
          <Route path="tv-screens" element={<AdminTvScreensPage />} />
          <Route path="signage" element={<Suspense fallback={<div className="spinner" aria-hidden="true" />}><AdminSignagePage /></Suspense>} />
        </Route>

        <Route
          path="/sa"
          element={
            <ProtectedRoute role="superadmin">
              <SaLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/sa/analytics" replace />} />
          <Route path="users" element={<SaUsersPage />} />
          <Route path="trial-requests" element={<SaTrialRequestsPage />} />
          <Route path="organizations" element={<SaOrganizationsPage />} />
          <Route path="organizations/:id" element={<SaOrganizationDetailPage />} />
          <Route path="analytics" element={<SaAnalyticsPage />} />
          <Route path="audit-logs" element={<SaAuditLogPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
