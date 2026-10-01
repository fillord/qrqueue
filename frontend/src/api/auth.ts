import { apiDelete, apiGet, apiPatch, apiPost, apiPutBinary } from './client'
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

export const updateMyName = (full_name: string) =>
  apiPatch<User>('/api/auth/me/name', { full_name })

export const updateMyPassword = (current_password: string, new_password: string) =>
  apiPost<User>('/api/auth/me/password', { current_password, new_password })

export const updateMyEmail = (email: string, current_password: string) =>
  apiPatch<User>('/api/auth/me/email', { email, current_password })

export const uploadMyPhoto = (file: File) =>
  apiPutBinary<User>('/api/auth/me/photo', file)

export const deleteMyPhoto = () =>
  apiDelete<User>('/api/auth/me/photo')

export const updateMyAssistant = (assistant_enabled: boolean, assistant_ai_enabled: boolean) =>
  apiPatch<User>('/api/auth/me/assistant', { assistant_enabled, assistant_ai_enabled })
