import { Route, Routes } from 'react-router-dom'

import LandingPage from '../pages/landing/LandingPage'
import LoginPage from '../pages/login/LoginPage'
import CabinetSelectPage from '../pages/operator/CabinetSelectPage'
import OperatorQueuePage from '../pages/operator/OperatorQueuePage'
import InDevelopmentPage from '../pages/placeholder/InDevelopmentPage'
import ScanPage from '../pages/scan/ScanPage'
import TicketPage from '../pages/ticket/TicketPage'
import Layout from './Layout'
import ProtectedRoute from './ProtectedRoute'

export default function AppRouter() {
  return (
    <Routes>
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
              <InDevelopmentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute role="org_admin">
              <InDevelopmentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sa"
          element={
            <ProtectedRoute role="superadmin">
              <InDevelopmentPage />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  )
}
