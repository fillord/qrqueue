import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { getAuditLogs, getOwnOrganization } from '../src/api/admin'
import { getOrganizations, getSaAuditLogs } from '../src/api/superadmin'
import type { AuditLogPage } from '../src/api/types'
import i18n from '../src/app/i18n'
import en from '../src/app/locales/en.json'
import kk from '../src/app/locales/kk.json'
import ru from '../src/app/locales/ru.json'
import { AUDIT_ACTIONS } from '../src/lib/auditLogPresentation'
import AdminAuditLogPage from '../src/pages/admin/AdminAuditLogPage'
import SaAuditLogPage from '../src/pages/superadmin/SaAuditLogPage'

vi.mock('../src/api/admin', () => ({ getAuditLogs: vi.fn(), getOwnOrganization: vi.fn() }))
vi.mock('../src/api/superadmin', () => ({ getOrganizations: vi.fn(), getSaAuditLogs: vi.fn() }))

const page: AuditLogPage = {
  items: [{
    id: 1, organization_id: 'org-1', actor_type: 'user', actor_id: 'user-1',
    actor_name: 'Дина', action: 'ticket.serving_started', entity_type: 'ticket',
    entity_id: 'ticket-1', entity_label: 'A-024', queue_name: 'Терапия', cabinet_label: 'Кабинет 3',
    payload: { rating: 5 }, ip: null, created_at: '2026-09-24T10:00:00Z',
  }],
  total: 1, limit: 25, offset: 0,
}

afterEach(cleanup)
beforeEach(async () => {
  await i18n.changeLanguage('ru')
  vi.mocked(getOwnOrganization).mockResolvedValue({ timezone: 'Asia/Almaty' } as Awaited<ReturnType<typeof getOwnOrganization>>)
  vi.mocked(getOrganizations).mockResolvedValue([])
  vi.mocked(getAuditLogs).mockResolvedValue(page)
  vi.mocked(getSaAuditLogs).mockResolvedValue(page)
})

it.each([ru, kk, en])('has a human-readable label for every audit action and entity', (locale) => {
  const labels = locale.admin.auditLog
  for (const [entity, actions] of Object.entries(AUDIT_ACTIONS)) {
    expect(labels.entities[entity as keyof typeof labels.entities]).toBeTruthy()
    for (const action of actions) {
      expect(labels.actions[entity as keyof typeof labels.actions][action as never]).toBeTruthy()
    }
  }
  expect(labels.entities.department_schedule_item).toBeTruthy()
})

it('shows readable entries and filters by the stored code for an organization admin', async () => {
  render(<AdminAuditLogPage />)
  expect(await screen.findByRole('cell', { name: 'Приём начат' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: /Талон A-024.*Терапия.*Кабинет 3/ })).toBeTruthy()
  expect(screen.queryByText('ticket.serving_started')).toBeNull()

  fireEvent.click(screen.getByText('Подробности'))
  expect(screen.getByText('Оценка')).toBeTruthy()
  expect(screen.getByText('5')).toBeTruthy()

  fireEvent.change(screen.getByRole('combobox', { name: 'Действие' }), { target: { value: 'ticket.called' } })
  await waitFor(() => expect(getAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'ticket.called' })))
})

it('shows the same readable entries and filter for a superadmin', async () => {
  render(<MemoryRouter><SaAuditLogPage /></MemoryRouter>)
  expect(await screen.findByRole('cell', { name: 'Приём начат' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: /Талон A-024.*Терапия.*Кабинет 3/ })).toBeTruthy()
  expect(screen.queryByText('ticket.serving_started')).toBeNull()

  fireEvent.change(screen.getByRole('combobox', { name: 'Действие' }), { target: { value: 'ticket.called' } })
  await waitFor(() => expect(getSaAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'ticket.called' })))
})
