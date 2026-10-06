import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiGet, apiPost } from '../src/api/client'
import i18n from '../src/app/i18n'
import TelegramTicketBanner from '../src/components/TelegramTicketBanner'

vi.mock('../src/api/client', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
beforeEach(async () => { vi.clearAllMocks(); await i18n.changeLanguage('ru') })
afterEach(cleanup)

it('offers the owner a Telegram opt-in link', async () => {
  vi.mocked(apiGet).mockResolvedValue({ available: true, connected: false })
  vi.mocked(apiPost).mockResolvedValue({ url: 'https://t.me/OmniBookTestBot?start=test' })
  render(<TelegramTicketBanner ticketId="ticket-1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Подключить Telegram' }))
  expect((await screen.findByRole('link', { name: 'Открыть Telegram' })).getAttribute('href')).toContain('https://t.me/')
  expect(apiPost).toHaveBeenCalledWith('/api/public/tickets/ticket-1/telegram')
})

it('shows connected status and disconnect instructions', async () => {
  vi.mocked(apiGet).mockResolvedValue({ available: true, connected: true })
  render(<TelegramTicketBanner ticketId="ticket-1" />)
  expect(await screen.findByText('Telegram подключён')).toBeTruthy()
  expect(screen.getByText('Отключение уведомлений: /stop в боте.')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
