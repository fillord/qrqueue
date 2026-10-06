import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import i18n from '../src/app/i18n'
import AppRouter from '../src/app/router'
import { useAuth } from '../src/app/AuthContext'
vi.mock('../src/app/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../src/api/client', async (original) => ({ ...await original(), apiGet: vi.fn().mockResolvedValue([]) }))
afterEach(cleanup)
beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(useAuth).mockReturnValue({ status: 'anonymous', user: null, login: vi.fn(), completeTotp: vi.fn(), logout: vi.fn() })
})
function Location() { const value = useLocation(); return <output data-testid="location">{value.pathname}</output> }
it.each(['/admin/users', '/admin/attendance/departments', '/sa/trial-requests', '/operator/queue', '/registrar'])('protects %s after the router upgrade', async (path) => {
  render(<MemoryRouter initialEntries={[path]}><AppRouter /><Location /></MemoryRouter>)
  await screen.findByRole('button', { name: i18n.t('login.submit') })
  expect(screen.getByTestId('location').textContent).toBe('/login')
})
it('renders the nested trial request page for a superadmin', async () => {
  vi.mocked(useAuth).mockReturnValue({ status: 'authenticated', user: { id: 'test', role: 'superadmin', full_name: 'QA', email: 'qa@example.com', organization_id: null }, login: vi.fn(), completeTotp: vi.fn(), logout: vi.fn() })
  render(<MemoryRouter initialEntries={['/sa/trial-requests']}><AppRouter /><Location /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Trial requests' })).toBeTruthy()
  expect(await screen.findByText('No requests yet')).toBeTruthy()
  expect(screen.getByText('vdev')).toBeTruthy()
  expect(screen.getByTestId('location').textContent).toBe('/sa/trial-requests')
})
