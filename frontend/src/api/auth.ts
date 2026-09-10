import { ApiError, apiGet, apiPost } from './client'
import type { LoginResult, User } from './types'

/**
 * Resolves once the session cookie is set. Throws ApiError('totp_not_supported')
 * if the backend ever asks for a second factor — no UI for that exists yet.
 */
export async function login(email: string, password: string): Promise<void> {
  const result = await apiPost<LoginResult>('/api/auth/login', { email, password })
  if (result.totp_required) {
    throw new ApiError(200, 'totp_not_supported')
  }
}

export function logout(): Promise<void> {
  return apiPost<void>('/api/auth/logout')
}

export function me(): Promise<User> {
  return apiGet<User>('/api/auth/me')
}
