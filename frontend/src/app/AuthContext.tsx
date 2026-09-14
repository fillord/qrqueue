import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { login as apiLogin, logout as apiLogout, me as apiMe, verifyTotp as apiVerifyTotp } from '../api/auth'
import type { TotpSetup, User } from '../api/types'

type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

/** Password step outcome: either a session, or a pending second factor
 * (with enrollment material when the account has no authenticator yet). */
export type LoginOutcome = { kind: 'authenticated'; user: User } | { kind: 'totp'; setup: TotpSetup | null }

interface AuthContextValue {
  user: User | null
  status: AuthStatus
  login: (email: string, password: string) => Promise<LoginOutcome>
  completeTotp: (code: string) => Promise<User>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Wraps the whole app (see App.tsx). Session state lives only in the
 * httpOnly access_token cookie, so this checks GET /auth/me once on mount
 * to learn whether a session already exists (e.g. after a page reload).
 *
 * api/client.ts dispatches a window 'api:unauthorized' event on any 401 —
 * this listens and drops back to anonymous so ProtectedRoute redirects to
 * /login on its next render, without every caller having to know about auth.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  useEffect(() => {
    let cancelled = false
    apiMe()
      .then((current) => {
        if (cancelled) return
        setUser(current)
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) return
        setUser(null)
        setStatus('anonymous')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function handleUnauthorized() {
      setUser(null)
      setStatus('anonymous')
    }
    window.addEventListener('api:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('api:unauthorized', handleUnauthorized)
  }, [])

  const finishLogin = useCallback(async () => {
    const current = await apiMe()
    setUser(current)
    setStatus('authenticated')
    return current
  }, [])

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const result = await apiLogin(email, password)
      if (result.totp_required) return { kind: 'totp', setup: result.totp_setup }
      return { kind: 'authenticated', user: await finishLogin() }
    },
    [finishLogin],
  )

  const completeTotp = useCallback(
    async (code: string) => {
      await apiVerifyTotp(code)
      return finishLogin()
    },
    [finishLogin],
  )

  const logout = useCallback(async () => {
    try {
      await apiLogout()
    } finally {
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  return <AuthContext.Provider value={{ user, status, login, completeTotp, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
