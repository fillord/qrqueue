import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import type { UserRole } from '../api/types'
import { useAuth } from './AuthContext'
import { roleHome } from './roleHome'

export default function ProtectedRoute({ role, children }: { role: UserRole; children: ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="page-spinner">
        <div className="spinner" aria-hidden="true" />
      </div>
    )
  }

  if (status === 'anonymous' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (user.role !== role) {
    return <Navigate to={roleHome(user.role)} replace />
  }

  return <>{children}</>
}
