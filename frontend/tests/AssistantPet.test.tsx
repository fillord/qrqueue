import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AssistantPet from '../src/components/AssistantPet'
import AssistantTour from '../src/components/AssistantTour'
import type { User } from '../src/api/types'
import i18n from '../src/app/i18n'

const getStatus = vi.fn()
const ask = vi.fn()
vi.mock('../src/api/assistant', () => ({
  getAssistantStatus: () => getStatus(),
  askAssistant: (...args: unknown[]) => ask(...args),
}))

const user: User = {
  id: 'user-1', email: 'admin@example.com', full_name: 'Admin', role: 'org_admin',
  organization_id: 'org-1', totp_enabled: true, has_photo: false, photo_revision: 0,
  assistant_enabled: true, assistant_ai_enabled: false,
}

function PasswordJourney({ currentUser }: { currentUser: User }) {
  const { pathname } = useLocation()
  return <>
    {pathname === '/profile'
      ? <section className="profile-card" data-profile-section="security"><h2>Пароль и безопасность</h2></section>
      : <Link className="app-header__profile" to="/profile">Admin</Link>}
    <AssistantPet user={currentUser} />
  </>
}

function OrganizationJourney({ currentUser }: { currentUser: User }) {
  const { pathname } = useLocation()
  return <>
    {pathname === '/admin/organization'
      ? <form className="admin-organization__form"><h2>Настройки организации</h2></form>
      : <Link to="/admin/organization">Настройки организации</Link>}
    <AssistantPet user={currentUser} />
  </>
}

describe('AssistantPet', () => {
  afterEach(() => cleanup())
  beforeEach(async () => {
    sessionStorage.clear()
    await i18n.changeLanguage('ru')
    getStatus.mockResolvedValue({ available: false })
    ask.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 480 })
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
    expect(document.querySelector<HTMLElement>('.assistant-pet__messages')?.scrollTop).toBe(480)
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

  it('offers a visual destination after an AI answer and uses exact settings names', async () => {
    getStatus.mockResolvedValue({ available: true })
    ask.mockResolvedValue({ answer: 'Откройте «Настройки организации».', source: 'gemini' })
    const aiUser = { ...user, assistant_ai_enabled: true }
    render(<MemoryRouter initialEntries={['/admin/queues']}><OrganizationJourney currentUser={aiUser} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть помощника' }))
    await waitFor(() => expect(getStatus).toHaveBeenCalled())
    fireEvent.change(screen.getByRole('textbox', { name: 'Напишите вопрос о системе' }), { target: { value: 'Где изменить название организации?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await screen.findByText('Откройте «Настройки организации».')
    fireEvent.click(screen.getByRole('button', { name: 'Показать, куда нажать' }))
    expect(screen.getByText('Нажмите на этот пункт, чтобы открыть нужный раздел.')).toBeTruthy()
    expect(document.querySelector('.assistant-tour__ring')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Настройки организации' }))
    await waitFor(() => expect(screen.getByText('Здесь изменяются название, логотип, цвет, язык, часовой пояс и правила талонов организации.')).toBeTruthy())
    expect(screen.getAllByRole('heading', { name: 'Настройки организации' }).length).toBeGreaterThanOrEqual(2)
    expect(document.querySelector('.assistant-tour__ring')).toBeTruthy()
  })

  it('continues a password walkthrough after navigating to profile settings', async () => {
    getStatus.mockResolvedValue({ available: true })
    ask.mockResolvedValue({ answer: 'Откройте настройки профиля.', source: 'gemini' })
    const aiUser = { ...user, assistant_ai_enabled: true }
    render(<MemoryRouter initialEntries={['/admin/queues']}><PasswordJourney currentUser={aiUser} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть помощника' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Напишите вопрос о системе' }), { target: { value: 'Как поменять пароль?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await screen.findByText('Откройте настройки профиля.')
    fireEvent.click(screen.getByRole('button', { name: 'Показать, куда нажать' }))
    expect(screen.getByText('Нажмите на своё имя или фотографию справа сверху — так открываются настройки профиля.')).toBeTruthy()
    expect(document.querySelector('.assistant-tour__ring')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Admin' }))
    await waitFor(() => expect(screen.getByText('Пароль текущего пользователя изменяется в этом блоке.')).toBeTruthy())
    expect(screen.getAllByRole('heading', { name: 'Пароль и безопасность' }).length).toBeGreaterThanOrEqual(2)
  })

  it('finds a renamed navigation target by its visible label', () => {
    render(<>
      <a href="/admin/problems">Центр проблем</a>
      <AssistantTour
        steps={[{ selector: '[data-old-selector]', titleKey: 'assistant.pages.problems.title', bodyKey: 'assistant.tour.actions.problemFilters' }]}
        index={0}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />
    </>)
    expect(document.querySelector('.assistant-tour__ring')).toBeTruthy()
    expect(document.querySelector('.assistant-tour__shade--full')).toBeFalsy()
  })
})
