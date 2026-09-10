import { BrowserRouter } from 'react-router-dom'

import './i18n'
import AppRouter from './router'

export default function App() {
  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  )
}
