import { useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'

import { registerServiceWorker } from '../lib/push'
import './i18n'
import AppRouter from './router'
import { AuthProvider } from './AuthContext'

export default function App() {
  useEffect(() => {
    // No-op on unsupported browsers (see isPushSupported inside) — this
    // just gets the worker installed early so it's ready by the time
    // PushOptInBanner asks to subscribe.
    void registerServiceWorker()
  }, [])

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  )
}
