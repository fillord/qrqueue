import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '../src/api/client'
import { queueKioskApi, type KioskReceipt, type KioskState } from '../src/api/queueKiosk'
import { getAdminQueues } from '../src/api/admin'
import i18n from '../src/app/i18n'
import QueueKioskPage from '../src/pages/kiosk/QueueKioskPage'
import AdminQueueKiosksPage from '../src/pages/admin/AdminQueueKiosksPage'

vi.mock('../src/api/queueKiosk', () => ({ queueKioskApi: {
  state: vi.fn(), issue: vi.fn(), receipt: vi.fn(), print: vi.fn(), pair: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), unpair: vi.fn(), archive: vi.fn(),
} }))
vi.mock('../src/api/admin', () => ({ getAdminQueues: vi.fn() }))
const q1 = '11111111-1111-4111-8111-111111111111'
const q2 = '22222222-2222-4222-8222-222222222222'
const requestId = '33333333-3333-4333-8333-333333333333'
const station: KioskState = { id: 'kiosk-1', name: 'Вход', organization_name: 'OmniBook Demo', language: 'ru', printing_enabled: false, paper_width: 80,
  queues: [{ id: q1, name: 'Консультация', unavailable_reason: null }, { id: q2, name: 'Анализы', unavailable_reason: null }] }
const receipt: KioskReceipt = { request_id: requestId, ticket_id: 'ticket-1', queue_id: q1, display_number: 'A-001', queue_name: 'Консультация',
  organization_name: 'OmniBook Demo', created_at: '2026-10-06T08:00:00Z', timezone: 'Asia/Almaty', ahead: 3, language: 'ru', printing_enabled: false, paper_width: 80 }
beforeEach(async () => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); await i18n.changeLanguage('ru')
  localStorage.setItem('queue.kiosk.deviceToken', 'device-test')
  vi.mocked(queueKioskApi.state).mockResolvedValue(station)
  vi.mocked(queueKioskApi.issue).mockResolvedValue(receipt)
  vi.mocked(queueKioskApi.print).mockResolvedValue({ ...receipt, printing_enabled: true })
  vi.spyOn(window, 'print').mockImplementation(() => window.dispatchEvent(new Event('afterprint')))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear() })

async function selectService() {
  fireEvent.click(await screen.findByRole('button', { name: 'Получить талон' }))
  fireEvent.click(screen.getByRole('button', { name: 'Консультация' }))
  await screen.findByRole('heading', { name: 'Ваш номер в очереди' })
}

it('starts with space, supports arrow selection and does not issue just by starting', async () => {
  render(<QueueKioskPage />)
  await screen.findByRole('button', { name: 'Получить талон' })
  await act(async () => {}) // Flush passive keyboard listeners after the async station load.
  fireEvent.keyDown(window, { key: ' ', code: 'Space' }); fireEvent.keyUp(window, { key: ' ', code: 'Space' })
  expect(screen.getByRole('heading', { name: 'Выберите услугу' })).toBeTruthy()
  expect(queueKioskApi.issue).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Консультация' }))
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Анализы' }))
  fireEvent.click(document.activeElement!)
  await screen.findByRole('heading', { name: 'Ваш номер в очереди' })
  expect(queueKioskApi.issue).toHaveBeenCalledTimes(1)
  expect(queueKioskApi.issue).toHaveBeenCalledWith('device-test', expect.objectContaining({ queue_id: q2 }))
  expect(screen.queryByRole('button', { name: 'Распечатать талон' })).toBeNull()
})

it('retries an uncertain request with the same ID and prevents double-click creation', async () => {
  vi.mocked(queueKioskApi.issue).mockRejectedValueOnce(new Error('response lost'))
  render(<QueueKioskPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Получить талон' }))
  const service = screen.getByRole('button', { name: 'Консультация' })
  fireEvent.click(service); fireEvent.click(service)
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
  await screen.findByRole('heading', { name: 'Ваш номер в очереди' })
  const calls = vi.mocked(queueKioskApi.issue).mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0][1].request_id).toBe(calls[1][1].request_id)
  expect(screen.getByText('Перед вами в момент выдачи: 3')).toBeTruthy()
})

it('recovers after reload with a read and never issues automatically', async () => {
  sessionStorage.setItem('queue.kiosk.intent.kiosk-1', JSON.stringify({ request_id: requestId, queue_id: q1 }))
  vi.mocked(queueKioskApi.receipt).mockResolvedValue(receipt)
  render(<QueueKioskPage />)
  await screen.findByRole('heading', { name: 'Ваш номер в очереди' })
  expect(queueKioskApi.receipt).toHaveBeenCalledWith('device-test', requestId)
  expect(queueKioskApi.issue).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
  expect(sessionStorage.getItem('queue.kiosk.intent.kiosk-1')).toBeNull()
})

it('returns to welcome after inactivity without cancelling the issued ticket', async () => {
  render(<QueueKioskPage />); await selectService()
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 46000)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Получить талон' })).toBeTruthy(), { timeout: 2000 })
  expect(queueKioskApi.issue).toHaveBeenCalledTimes(1)
})

it('prints and reprints the same receipt, including after dialog cancellation', async () => {
  vi.mocked(queueKioskApi.state).mockResolvedValue({ ...station, printing_enabled: true })
  vi.mocked(queueKioskApi.issue).mockResolvedValue({ ...receipt, printing_enabled: true })
  render(<QueueKioskPage />); await selectService()
  fireEvent.click(screen.getByRole('button', { name: 'Распечатать талон' }))
  await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить печать' }))
  await waitFor(() => expect(window.print).toHaveBeenCalledTimes(2))
  expect(queueKioskApi.issue).toHaveBeenCalledTimes(1)
  expect(queueKioskApi.print).toHaveBeenNthCalledWith(2, 'device-test', requestId)
})

it('does not open the dialog if printing was disabled on the server', async () => {
  vi.mocked(queueKioskApi.state).mockResolvedValue({ ...station, printing_enabled: true })
  vi.mocked(queueKioskApi.issue).mockResolvedValue({ ...receipt, printing_enabled: true })
  vi.mocked(queueKioskApi.print).mockRejectedValue(new ApiError(409, 'kiosk_printing_disabled'))
  render(<QueueKioskPage />); await selectService()
  fireEvent.click(screen.getByRole('button', { name: 'Распечатать талон' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Печать отключена')
  expect(window.print).not.toHaveBeenCalled()
  expect(queueKioskApi.issue).toHaveBeenCalledTimes(1)
})

it('pauses the reset timer while the print dialog is open', async () => {
  vi.mocked(queueKioskApi.state).mockResolvedValue({ ...station, printing_enabled: true })
  vi.mocked(queueKioskApi.issue).mockResolvedValue({ ...receipt, printing_enabled: true })
  vi.mocked(window.print).mockImplementation(() => {})
  render(<QueueKioskPage />); await selectService()
  fireEvent.click(screen.getByRole('button', { name: 'Распечатать талон' }))
  await waitFor(() => expect(window.print).toHaveBeenCalled())
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000)
  expect(screen.getByRole('heading', { name: 'Ваш номер в очереди' })).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Готово' }) as HTMLButtonElement).disabled).toBe(true)
  act(() => window.dispatchEvent(new Event('afterprint')))
  expect((screen.getByRole('button', { name: 'Готово' }) as HTMLButtonElement).disabled).toBe(false)
})

it('requires pairing again when the device credential is revoked', async () => {
  vi.mocked(queueKioskApi.state).mockRejectedValue(new ApiError(401, 'kiosk_not_paired'))
  render(<QueueKioskPage />)
  await screen.findByRole('heading', { name: 'Подключение стойки выдачи талонов' })
  expect(localStorage.getItem('queue.kiosk.deviceToken')).toBeNull()
})

it('creates a kiosk with selected queues and printing disabled by default', async () => {
  vi.mocked(queueKioskApi.list).mockResolvedValue([])
  vi.mocked(getAdminQueues).mockResolvedValue([{ id: q1, name: 'Консультация', is_active: true }] as Awaited<ReturnType<typeof getAdminQueues>>)
  render(<MemoryRouter><AdminQueueKiosksPage /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Название стойки'), { target: { value: 'Вход' } })
  fireEvent.click(await screen.findByLabelText('Консультация'))
  fireEvent.click(screen.getByRole('button', { name: 'Добавить стойку' }))
  await waitFor(() => expect(queueKioskApi.create).toHaveBeenCalledWith({ name: 'Вход', queue_ids: [q1], printing_enabled: false, paper_width: 80, language: 'ru' }))
})

it.each(['ru', 'kk', 'en'])('has complete kiosk translations in %s', language => {
  const base = i18n.getResourceBundle('ru', 'translation').queueKiosk
  const value = i18n.getResourceBundle(language, 'translation').queueKiosk
  expect(Object.keys(value).sort()).toEqual(Object.keys(base).sort())
  expect(Object.keys(value.errors).sort()).toEqual(Object.keys(base.errors).sort())
})
