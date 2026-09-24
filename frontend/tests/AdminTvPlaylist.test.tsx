import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import i18n from '../src/app/i18n'
import type { TvScreen } from '../src/api/types'
import { getAdminCabinets, getAdminQueues, getTvScreens, updateTvScreen } from '../src/api/admin'
import { listMedia } from '../src/api/signage'
import AdminTvScreensPage from '../src/pages/admin/AdminTvScreensPage'

vi.mock('../src/api/admin', () => ({
  createTvScreen: vi.fn(), deleteTvScreen: vi.fn(), getAdminCabinets: vi.fn(), getAdminQueues: vi.fn(),
  getTvScreens: vi.fn(), updateTvScreen: vi.fn(),
}))
vi.mock('../src/api/signage', () => ({ listMedia: vi.fn() }))

afterEach(cleanup)
beforeEach(async () => {
  await i18n.changeLanguage('en')
  const tv: TvScreen = {
    id: 'screen-1', organization_id: 'org-1', queue_id: null, name: 'Lobby media',
    pairing_code: null, language: 'en', last_seen_at: null, display_mode: 'media',
    slide_seconds: 15, ads_enabled: false, media_playlist_mode: 'all', selected_media_ids: [],
    queue_selection_mode: 'all', selected_queue_ids: [], cabinet_selection_mode: 'all', selected_cabinet_ids: [],
  }
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
  }
  vi.mocked(getTvScreens).mockImplementation(async () => [{ ...tv }])
  vi.mocked(updateTvScreen).mockImplementation(async (_id, changes) => {
    Object.assign(tv, changes)
    return { ...tv }
  })
  render(<AdminTvScreensPage />)
  fireEvent.click(await screen.findByRole('radio', { name: 'Only checked queues' }))
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Therapy' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Therapy' }))
  await waitFor(() => expect(updateTvScreen).toHaveBeenCalledWith('screen-1', { selected_queue_ids: ['queue-1'] }, undefined))
  fireEvent.click(screen.getByRole('radio', { name: 'Only from checked cabinets' }))
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Room 1 · Therapy' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Room 1 · Therapy' }))
  await waitFor(() => expect(updateTvScreen).toHaveBeenCalledWith('screen-1', { selected_cabinet_ids: ['cabinet-1'] }, undefined))
})

it('lets an admin switch a media TV to a repeating selection and check clips', async () => {
  render(<AdminTvScreensPage />)
  fireEvent.click(await screen.findByRole('radio', { name: 'Repeat only checked media' }))
  const clip = await screen.findByRole<HTMLInputElement>('checkbox', { name: 'Clip two' })
  await waitFor(() => expect(clip.disabled).toBe(false))
  fireEvent.click(clip)
  await waitFor(() => expect(updateTvScreen).toHaveBeenCalledWith('screen-1', { selected_media_ids: ['clip-2'] }, undefined))
  expect((await screen.findByRole<HTMLInputElement>('checkbox', { name: 'Clip two' })).checked).toBe(true)
})
