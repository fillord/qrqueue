import type { UserRole } from '../api/types'

export function roleHome(role: UserRole): string {
  switch (role) {
    case 'operator':
      return '/operator'
    case 'registrar':
      return '/registrar'
    case 'org_admin':
      return '/admin'
    case 'superadmin':
      return '/sa/analytics'
  }
}
