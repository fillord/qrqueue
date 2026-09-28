import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import i18n from '../src/app/i18n'
import type { TvScreen } from '../src/api/types'
import { createTvScreen, getAdminCabinets, getAdminQueues, getTvScreens, unpairTvScreen, updateTvScreen } from '../src/api/admin'
import { listDepartments, listMedia } from '../src/api/signage'
import AdminTvScreensPage from '../src/pages/admin/AdminTvScreensPage'

vi.mock('../src/api/admin', () => ({
  createTvScreen: vi.fn(), deleteTvScreen: vi.fn(), getAdminCabinets: vi.fn(), getAdminQueues: vi.fn(),
  getTvScreens: vi.fn(), unpairTvScreen: vi.fn(), updateTvScreen: vi.fn(),
}))
vi.mock('../src/api/signage', () => ({ listDepartments: vi.fn(), listMedia: vi.fn() }))

afterEach(cleanup)
beforeEach(async () => {
  await i18n.changeLanguage('en')
  const tv: TvScreen = {
    id: 'screen-1', organization_id: 'org-1', queue_id: null, name: 'Lobby media',
    pairing_code: null, language: 'en', last_seen_at: null, display_mode: 'media',
    slide_seconds: 15, ads_enabled: false, media_playlist_mode: 'all', selected_media_ids: [],
    queue_selection_mode: 'all', selected_queue_ids: [], cabinet_selection_mode: 'all', selected_cabinet_ids: [],
    department_selection_mode: 'all', selected_department_ids: [],
  }
  vi.mocked(listDepartments).mockResolvedValue([])
  vi.mocked(getAdminQueues).mockResolvedValue([])
  vi.mocked(getAdminCabinets).mockResolvedValue([])
  vi.mocked(listMedia).mockResolvedValue([
    { id: 'clip-1', organization_id: 'org-1', title: 'Clip one', kind: 'video', mime_type: 'video/mp4', size_bytes: 1, uploaded_bytes: 1, is_ready: true, is_active: true, sort_order: 0, created_at: '' },
    { id: 'clip-2', organization_id: 'org-1', title: 'Clip two', kind: 'video', mime_type: 'video/mp4', size_bytes: 1, uploaded_bytes: 1, is_ready: true, is_active: true, sort_order: 1, created_at: '' },
  ])
  vi.mocked(getTvScreens).mockImplementation(async () => [{ ...tv }])
  vi.mocked(updateTvScreen).mockImplementation(async (_id, changes) => {
    Object.assign(tv, changes)
    return { ...tv }
  })
})

it('lets an admin select several queues and cabinets for a hall display', async () => {
  const base = {
    organization_id: 'org-1', ticket_prefix: 'A', status: 'open' as const,
    latitude: null, longitude: null, geo_radius_m: null, presence_timeout_min: 15,
    daily_ticket_limit: null, last_ticket_number: 0, counter_date: '2026-09-24',
    is_active: true, deleted_at: null, waiting_count: 0,
  }
  vi.mocked(getAdminQueues).mockResolvedValue([
    { ...base, id: 'queue-1', name: 'Therapy' },
    { ...base, id: 'queue-2', name: 'Surgery' },
  ])
  vi.mocked(getAdminCabinets).mockResolvedValue([
    { id: 'cabinet-1', organization_id: 'org-1', queue_id: 'queue-1', label: 'Room 1', status: 'free', current_ticket_id: null, is_active: true, deleted_at: null },
    { id: 'cabinet-2', organization_id: 'org-1', queue_id: 'queue-2', label: 'Room 2', status: 'free', current_ticket_id: null, is_active: true, deleted_at: null },
  ])
  const tv: TvScreen = {
    id: 'screen-1', organization_id: 'org-1', queue_id: null, name: 'Hall',
    pairing_code: null, language: 'en', last_seen_at: null, display_mode: 'queue',
    slide_seconds: 15, ads_enabled: false, media_playlist_mode: 'all', selected_media_ids: [],
    queue_selection_mode: 'all', selected_queue_ids: [], cabinet_selection_mode: 'all', selected_cabinet_ids: [],
    department_selection_mode: 'all', selected_department_ids: [],
  }
  vi.mocked(getTvScreens).mockImplementation(async () => [{ ...tv }])
  vi.mocked(updateTvScreen).mockImplementation(async (_id, changes) => {
    Object.assign(tv, changes)
    return { ...tv }
  })
  render(<AdminTvScreensPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  fireEvent.click(await screen.findByRole('radio', { name: 'Only checked queues' }))
  const queueOptions = within(screen.getByRole('group', { name: 'Queues on the hall display' }))
  await waitFor(() => expect(queueOptions.getByRole<HTMLInputElement>('checkbox', { name: 'Therapy' }).disabled).toBe(false))
  fireEvent.click(queueOptions.getByRole('checkbox', { name: 'Therapy' }))
  await waitFor(() => expect(updateTvScreen).toHaveBeenCalledWith('screen-1', { selected_queue_ids: ['queue-1'] }, undefined))
  fireEvent.click(screen.getByRole('radio', { name: 'Only from checked cabinets' }))
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Room 1 · Therapy' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Room 1 · Therapy' }))
  await waitFor(() => expect(updateTvScreen).toHaveBeenCalledWith('screen-1', { selected_cabinet_ids: ['cabinet-1'] }, undefined))
})

it('creates a hall screen with selected queues so its QR offers exactly those queues', async () => {
  const base = {
    organization_id: 'org-1', ticket_prefix: 'A', status: 'open' as const,
    latitude: null, longitude: null, geo_radius_m: null, presence_timeout_min: 15,
    daily_ticket_limit: null, last_ticket_number: 0, counter_date: '2026-09-24',
    is_active: true, deleted_at: null, waiting_count: 0,
  }
  vi.mocked(getAdminQueues).mockResolvedValue([
    { ...base, id: 'queue-1', name: 'Therapy' },
    { ...base, id: 'queue-2', name: 'Surgery' },
  ])
  render(<AdminTvScreensPage />)
  const createQueues = within(await screen.findByRole('group', { name: 'Select queues for this TV' }))
  fireEvent.change(screen.getByPlaceholderText('Screen name'), { target: { value: 'Lobby' } })
  fireEvent.click(createQueues.getByRole('checkbox', { name: 'Therapy' }))
  fireEvent.click(createQueues.getByRole('checkbox', { name: 'Surgery' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(createTvScreen).toHaveBeenCalledWith({
    name: 'Lobby', queue_id: null, language: 'ru', display_mode: 'queue',
    queue_selection_mode: 'selected', selected_queue_ids: ['queue-1', 'queue-2'],
  }, undefined))
})

it('lets an admin switch a media TV to a repeating selection and check clips', async () => {
  render(<AdminTvScreensPage />)
  expect(screen.queryByRole('radio', { name: 'Repeat only checked media' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Show preview' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  expect(screen.queryByRole('spinbutton', { name: 'Seconds per screen' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show preview' }))
  expect(screen.getByTitle('Preview: Lobby media').getAttribute('src')).toBe('/tv/preview/screen-1')
  fireEvent.click(screen.getByRole('button', { name: 'Hide preview' }))
  expect(screen.queryByTitle('Preview: Lobby media')).toBeNull()
  fireEvent.click(await screen.findByRole('radio', { name: 'Repeat only checked media' }))
  const clip = await screen.findByRole<HTMLInputElement>('checkbox', { name: 'Clip two' })
  await waitFor(() => expect(clip.disabled).toBe(false))
  fireEvent.click(clip)
  await waitFor(() => expect(updateTvScreen).toHaveBeenCalledWith('screen-1', { selected_media_ids: ['clip-2'] }, undefined))
  expect((await screen.findByRole<HTMLInputElement>('checkbox', { name: 'Clip two' })).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
  expect(screen.queryByRole('radio', { name: 'Repeat only checked media' })).toBeNull()
})

it('shows connection state and last signal for TV screens', async () => {
  const base: TvScreen = {
    id: 'online', organization_id: 'org-1', queue_id: null, name: 'Lobby',
    pairing_code: null, language: 'en', last_seen_at: new Date().toISOString(),
    display_mode: 'media', slide_seconds: 15, ads_enabled: false,
    media_playlist_mode: 'all', selected_media_ids: [], queue_selection_mode: 'all',
    selected_queue_ids: [], cabinet_selection_mode: 'all', selected_cabinet_ids: [],
    department_selection_mode: 'all', selected_department_ids: [],
  }
  vi.mocked(getTvScreens).mockResolvedValue([
    base,
    { ...base, id: 'offline', name: 'Waiting room', last_seen_at: new Date(Date.now() - 300_000).toISOString() },
    { ...base, id: 'new', name: 'New screen', pairing_code: '123456', last_seen_at: null },
  ])
  render(<AdminTvScreensPage />)
  expect(await screen.findByText('Online')).toBeTruthy()
  expect(screen.getByText('Offline')).toBeTruthy()
  expect(screen.getByText('Awaiting pairing')).toBeTruthy()
  expect(screen.getByText('TV screens offline: 1')).toBeTruthy()
  expect(screen.getAllByText(/Last signal:/)).toHaveLength(2)
})

it('unpairs a TV without removing its screen settings and shows the new code', async () => {
  const paired: TvScreen = {
    id: 'screen-1', organization_id: 'org-1', queue_id: null, name: 'Lobby',
    pairing_code: null, language: 'en', last_seen_at: new Date().toISOString(),
    display_mode: 'schedule', slide_seconds: 20, ads_enabled: false,
    media_playlist_mode: 'all', selected_media_ids: [], queue_selection_mode: 'all',
    selected_queue_ids: [], cabinet_selection_mode: 'all', selected_cabinet_ids: [],
    department_selection_mode: 'all', selected_department_ids: [],
  }
  vi.mocked(getTvScreens).mockImplementation(async () => [{ ...paired }])
  vi.mocked(unpairTvScreen).mockImplementation(async () => {
    paired.pairing_code = '654321'
    paired.last_seen_at = null
    return { ...paired }
  })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<AdminTvScreensPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Unpair TV' }))
  await waitFor(() => expect(unpairTvScreen).toHaveBeenCalledWith('screen-1', undefined))
  expect(await screen.findByText('654321')).toBeTruthy()
  expect(screen.getByText('Lobby')).toBeTruthy()
  expect(within(screen.getByRole('article')).getByText('Department schedules')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Unpair TV' })).toBeNull()
  confirm.mockRestore()
})

it('lets an admin exclude internal departments from a schedule TV', async () => {
  const tv: TvScreen = {
    id: 'screen-schedule', organization_id: 'org-1', queue_id: null, name: 'Weekly schedule',
    pairing_code: null, language: 'ru', last_seen_at: null, display_mode: 'schedule',
    slide_seconds: 15, ads_enabled: false, media_playlist_mode: 'all', selected_media_ids: [],
    queue_selection_mode: 'all', selected_queue_ids: [], cabinet_selection_mode: 'all', selected_cabinet_ids: [],
    department_selection_mode: 'all', selected_department_ids: [],
  }
  vi.mocked(listDepartments).mockResolvedValue([
    { id: 'clinical', organization_id: 'org-1', name: 'Cardiology', sort_order: 0, is_active: true },
    { id: 'internal', organization_id: 'org-1', name: 'Administration', sort_order: 1, is_active: true },
  ])
  vi.mocked(getTvScreens).mockImplementation(async () => [{ ...tv }])
  vi.mocked(updateTvScreen).mockImplementation(async (_id, changes) => {
    Object.assign(tv, changes)
    return { ...tv }
  })

  render(<AdminTvScreensPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Show only checked departments' }))
  await waitFor(() => expect(updateTvScreen).toHaveBeenCalledWith('screen-schedule', {
    department_selection_mode: 'selected', selected_department_ids: ['clinical', 'internal'],
  }, undefined))
  const options = within(screen.getByRole('group', { name: 'Departments on this TV' }))
  const internal = await options.findByRole<HTMLInputElement>('checkbox', { name: 'Administration' })
  await waitFor(() => expect(internal.disabled).toBe(false))
  fireEvent.click(internal)
  await waitFor(() => expect(updateTvScreen).toHaveBeenCalledWith('screen-schedule', {
    selected_department_ids: ['clinical'],
  }, undefined))
  expect((await options.findByRole<HTMLInputElement>('checkbox', { name: 'Cardiology' })).checked).toBe(true)
  expect((await options.findByRole<HTMLInputElement>('checkbox', { name: 'Administration' })).checked).toBe(false)
})
