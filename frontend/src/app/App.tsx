import { BrowserRouter } from 'react-router-dom'

import './i18n'
import AppRouter from './router'
import { AuthProvider } from './AuthContext'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  )
}
