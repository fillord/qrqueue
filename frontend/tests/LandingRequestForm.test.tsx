import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '../src/app/i18n'
import LandingRequestForm from '../src/pages/landing/LandingRequestForm'
import { apiPost } from '../src/api/client'
vi.mock('../src/api/client', () => ({ apiPost: vi.fn() }))
beforeEach(async () => { await i18n.changeLanguage('en'); vi.mocked(apiPost).mockReset() })
afterEach(cleanup)
function fill() {
  render(<LandingRequestForm />)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
  fireEvent.change(screen.getByLabelText('Phone or email'), { target: { value: 'ada@example.com' } })
  fireEvent.submit(screen.getByRole('button').closest('form')!)
}
it('only shows success after the request is saved', async () => {
  vi.mocked(apiPost).mockResolvedValue({ accepted: true })
  fill()
  await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/public/trial-requests', { name: 'Ada', organization: '', contact: 'ada@example.com' }))
  await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
})
it('preserves input and lets the visitor retry a failed request', async () => {
  vi.mocked(apiPost).mockRejectedValue(new Error('offline'))
  fill()
  await waitFor(() => expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false))
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ada')
  expect(screen.getByText(i18n.t('landing.cta.form.error'))).toBeTruthy()
})
