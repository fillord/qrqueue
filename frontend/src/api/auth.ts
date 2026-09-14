import { apiGet, apiPost } from './client'
import type { LoginResult, User } from './types'

/** Password step. When the result says totp_required, the session cookie is
 * not set yet — call verifyTotp() with the authenticator code. */
export function login(email: string, password: string): Promise<LoginResult> {
  return apiPost<LoginResult>('/api/auth/login', { email, password })
}

export function verifyTotp(code: string): Promise<LoginResult> {
  return apiPost<LoginResult>('/api/auth/totp', { code })
}

export function logout(): Promise<void> {
  return apiPost<void>('/api/auth/logout')
}

export function me(): Promise<User> {
  return apiGet<User>('/api/auth/me')
}
