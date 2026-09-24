import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it } from 'vitest'

import i18n from '../src/app/i18n'
import AdminLayout from '../src/pages/admin/AdminLayout'
import SaLayout from '../src/pages/superadmin/SaLayout'

beforeEach(async () => {
  window.localStorage.clear()
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

function mount(role: 'admin' | 'sa') {
  const path = role === 'admin' ? '/admin/users' : '/sa/users'
  const Layout = role === 'admin' ? AdminLayout : SaLayout
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path={`/${role}`} element={<Layout />}>
      <Route path="users" element={<div>Wide workspace</div>} />
    </Route>
  </Routes></MemoryRouter>)
}

it.each(['admin', 'sa'] as const)('%s can hide the sidebar while keeping the workspace visible', (role) => {
  const view = mount(role)
  expect(screen.getByRole('navigation', { name: 'Dashboard sections' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Hide menu' }))
  expect(screen.queryByRole('navigation', { name: 'Dashboard sections' })).toBeNull()
  expect(screen.getByText('Wide workspace')).toBeTruthy()
  expect(window.localStorage.getItem('queue.dashboard.menuOpen')).toBe('false')
  view.unmount()
  mount(role)
  expect(screen.getByRole('button', { name: 'Show menu' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Show menu' }))
  expect(screen.getByRole('navigation', { name: 'Dashboard sections' })).toBeTruthy()
})
