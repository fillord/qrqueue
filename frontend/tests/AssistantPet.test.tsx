import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AssistantPet from '../src/components/AssistantPet'
import type { User } from '../src/api/types'
import i18n from '../src/app/i18n'

const getStatus = vi.fn()
vi.mock('../src/api/assistant', () => ({
  getAssistantStatus: () => getStatus(),
  askAssistant: vi.fn(),
}))

const user: User = {
  id: 'user-1', email: 'admin@example.com', full_name: 'Admin', role: 'org_admin',
  organization_id: 'org-1', totp_enabled: true, has_photo: false, photo_revision: 0,
  assistant_enabled: true, assistant_ai_enabled: false,
}

describe('AssistantPet', () => {
  afterEach(() => cleanup())
  beforeEach(async () => {
    sessionStorage.clear()
    await i18n.changeLanguage('ru')
    getStatus.mockResolvedValue({ available: false })
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 120, top: 120, left: 100, right: 300, bottom: 164,
      width: 200, height: 44, toJSON: () => ({}),
    } as DOMRect)
  })

  it('shows page-specific guidance and keeps local help when AI is off', async () => {
    render(<MemoryRouter initialEntries={['/admin/queues']}><AssistantPet user={user} /></MemoryRouter>)
    expect(screen.getByText('Очереди')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть помощника' }))
    await waitFor(() => expect(getStatus).toHaveBeenCalled())
    expect(screen.getByText('Настройки')).toBeTruthy()
    expect(screen.getByText(/Ответы ИИ отключены/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Как создать и запустить очередь?' }))
    expect(screen.getByText(/Для подробного ответа включите ИИ/)).toBeTruthy()
  })

  it('dims the page and highlights the relevant control in guided mode', () => {
    render(<MemoryRouter initialEntries={['/admin/queues']}>
      <button type="button" data-assistant-tour="create-queue">Создать очередь</button>
      <AssistantPet user={user} />
    </MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть помощника' }))
    fireEvent.click(screen.getByRole('button', { name: /Показать на странице/ }))
    expect(screen.getByTestId('assistant-tour')).toBeTruthy()
    expect(screen.getByText('Шаг 1 из 2')).toBeTruthy()
    expect(document.querySelector('.assistant-tour__ring')).toBeTruthy()
    expect(screen.getByText(/Нажмите на подсвеченный элемент/)).toBeTruthy()
  })
})
