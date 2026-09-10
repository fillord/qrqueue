import { Route, Routes } from 'react-router-dom'

import LandingPage from '../pages/landing/LandingPage'
import ScanPage from '../pages/scan/ScanPage'
import TicketPage from '../pages/ticket/TicketPage'
import Layout from './Layout'

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/q" element={<ScanPage />} />
        <Route path="/t/:id" element={<TicketPage />} />
      </Route>
    </Routes>
  )
}
