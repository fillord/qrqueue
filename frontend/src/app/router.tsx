import SaUsersPage from '../pages/superadmin/SaUsersPage'
import SaTrialRequestsPage from '../pages/superadmin/SaTrialRequestsPage'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import AdminAnalyticsPage from '../pages/admin/AdminAnalyticsPage'
import AdminAuditLogPage from '../pages/admin/AdminAuditLogPage'
import AdminCabinetsPage from '../pages/admin/AdminCabinetsPage'
import AdminLayout from '../pages/admin/AdminLayout'
import AdminOrganizationPage from '../pages/admin/AdminOrganizationPage'
import AdminQueueSchedulePage from '../pages/admin/AdminQueueSchedulePage'
import AdminQueuesPage from '../pages/admin/AdminQueuesPage'
import AdminTvScreensPage from '../pages/admin/AdminTvScreensPage'
import AdminUsersPage from '../pages/admin/AdminUsersPage'
import LandingPage from '../pages/landing/LandingPage'
import LoginPage from '../pages/login/LoginPage'
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
import TvPairPage from '../pages/tv/TvPairPage'
import Layout from './Layout'
import ProtectedRoute from './ProtectedRoute'

const AdminSignagePage = lazy(() => import('../pages/admin/AdminSignagePage'))

export default function AppRouter() {
  return (
    <Routes>
      {/* TV screens run fullscreen, chrome-free — no shared app header. */}
      <Route path="/tv/pair" element={<TvPairPage />} />
      <Route path="/tv" element={<TvPage />} />

      <Route element={<Layout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/q" element={<ScanPage />} />
        <Route path="/t/:id" element={<TicketPage />} />
        <Route path="/login" element={<LoginPage />} />
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
          <Route index element={<Navigate to="/admin/analytics" replace />} />
          <Route path="analytics" element={<AdminAnalyticsPage />} />
          <Route path="audit-logs" element={<AdminAuditLogPage />} />
          <Route path="organization" element={<AdminOrganizationPage />} />
          <Route path="queues" element={<AdminQueuesPage />} />
          <Route path="queues/:id/schedule" element={<AdminQueueSchedulePage />} />
          <Route path="cabinets" element={<AdminCabinetsPage />} />
          <Route path="users" element={<AdminUsersPage />} />
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
