import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import '../src/app/i18n'
import type { TvState } from '../src/api/types'
import MediaView from '../src/pages/tv/MediaView'
import ScheduleView from '../src/pages/tv/ScheduleView'

beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('shows all seven weekdays at once on a narrow screen, then switches departments', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T03:00:00Z')) // Monday in Asia/Almaty.
  vi.stubGlobal('innerWidth', 600)
  vi.stubGlobal('innerHeight', 800)
  const state: TvState = {
    organization_name: 'Clinic', logo_url: null, brand_color: null, language: 'ru',
    is_hall_screen: true, queues: [], recent_calls: [], timezone: 'Asia/Almaty', display_mode: 'schedule',
    slide_seconds: 5, ads_enabled: true,
    departments: [
      { id: 'one', name: 'Кардиология', entries: [{ id: 'e1', department_id: 'one',
        doctor_name: 'Доктор Айгуль', service_name: null, room: '12', weekday: 0,
        starts_at: '09:00:00', ends_at: '13:00:00', sort_order: 0 },
      { id: 'e2', department_id: 'one', doctor_name: 'Доктор Айгуль', service_name: null,
        room: '12', weekday: 6, starts_at: '10:00:00', ends_at: '15:00:00', sort_order: 0 }] },
      { id: 'two', name: 'Терапия', entries: [] },
    ],
    media: [{ id: 'ad', title: 'Объявление', kind: 'advertisement', mime_type: 'image/png', url: '/api/tv/media/ad' }],
  }
  render(<ScheduleView state={state} />)
  expect(screen.getByText('Кардиология')).toBeTruthy()
  expect(screen.getAllByText('Доктор Айгуль')).toHaveLength(1)
  expect(screen.getAllByRole('columnheader')).toHaveLength(10)
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    expect(screen.getByRole('columnheader', { name: day })).toBeTruthy()
  }
  expect(screen.getByRole('table').textContent).toContain('09:00–13:00')
  expect(screen.getByRole('table').textContent).toContain('10:00–15:00')
  act(() => vi.advanceTimersByTime(5000))
  expect(screen.getByText('Терапия')).toBeTruthy()
  expect(screen.getAllByRole('columnheader')).toHaveLength(10)
  act(() => vi.advanceTimersByTime(5000))
  expect(screen.getByText('Кардиология')).toBeTruthy()
  expect(screen.queryByRole('img', { name: 'Объявление' })).toBeNull()
})

it('eventually shows every doctor when one weekday spans several pages', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T03:00:00Z'))
  const state: TvState = {
    organization_name: 'Clinic', logo_url: null, brand_color: null, language: 'ru',
    is_hall_screen: true, queues: [], recent_calls: [], timezone: 'Asia/Almaty', display_mode: 'schedule',
    slide_seconds: 5, ads_enabled: false, media: [],
    departments: [{ id: 'one', name: 'Кардиология', entries: Array.from({ length: 8 }, (_, index) => ({
      id: `doctor-${index}`, department_id: 'one', doctor_name: `Врач ${index + 1}`,
      service_name: null, room: null, weekday: 0, starts_at: `${String(index + 8).padStart(2, '0')}:00:00`,
      ends_at: `${String(index + 9).padStart(2, '0')}:00:00`, sort_order: index,
    })) }],
  }
  render(<ScheduleView state={state} />)
  const seen = new Set<string>()
  for (let page = 0; page < 20; page += 1) {
    for (let doctor = 1; doctor <= 8; doctor += 1) {
      if (screen.queryByText(`Врач ${doctor}`)) seen.add(`Врач ${doctor}`)
    }
    act(() => vi.advanceTimersByTime(5000))
  }
  expect(seen.size).toBe(8)
})

it('keeps three doctors in one full-height department slide', () => {
  vi.stubGlobal('innerWidth', 1920)
  vi.stubGlobal('innerHeight', 1080)
  const state: TvState = {
    organization_name: 'Clinic', logo_url: null, brand_color: null, language: 'ru',
    is_hall_screen: true, queues: [], recent_calls: [], timezone: 'Asia/Almaty', display_mode: 'schedule',
    slide_seconds: 5, ads_enabled: false, media: [],
    departments: [{ id: 'one', name: 'Therapy', entries: Array.from({ length: 3 }, (_, index) => ({
      id: `doctor-${index}`, department_id: 'one', doctor_name: `Doctor ${index + 1}`,
      service_name: null, room: null, weekday: 0, starts_at: '09:00:00', ends_at: '17:00:00', sort_order: index,
    })) }],
  }
  const { container } = render(<ScheduleView state={state} />)
  expect(screen.getAllByRole('row')).toHaveLength(4)
  expect(container.querySelector('.tv-signage__page')).toBeNull()
  expect(parseFloat(container.querySelector<HTMLElement>('.tv-signage__table')!.style.fontSize)).toBeGreaterThan(2)
})

it('rotates an announcement into a YouTube clip and advances when the clip ends', async () => {
  vi.useFakeTimers()
  let config: any
  let player: any
  vi.stubGlobal('YT', {
    PlayerState: { ENDED: 0, PLAYING: 1 },
    Player: class {
      constructor(_host: HTMLElement, options: any) { config = options; player = this }
      getIframe() { return document.createElement('iframe') }
      mute() {}
      playVideo() {}
      destroy() {}
      seekTo() {}
      getPlaylist() { return [] }
      getPlaylistIndex() { return 0 }
    },
  })
  const state: TvState = {
    organization_name: 'Clinic', logo_url: null, brand_color: null, language: 'ru',
    is_hall_screen: true, queues: [], recent_calls: [], timezone: 'Asia/Almaty', display_mode: 'media',
    slide_seconds: 5, ads_enabled: true, departments: [],
    media: [
      { id: 'poster', title: 'Объявление', kind: 'advertisement', mime_type: 'image/png', url: '/api/tv/media/poster' },
      { id: 'film', title: 'Ролик', kind: 'youtube_video', mime_type: 'text/youtube', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
    ],
  }
  const { container } = render(<MediaView state={state} />)
  expect(screen.getByRole('img', { name: 'Объявление' })).toBeTruthy()
  act(() => vi.advanceTimersByTime(5000))
  await act(async () => {})
  expect(config.videoId).toBe('dQw4w9WgXcQ')
  expect(config.playerVars.mute).toBe(1)
  expect(container.querySelector('video')).toBeNull()
  act(() => config.events.onStateChange({ target: player, data: 0 }))
  expect(screen.getByRole('img', { name: 'Объявление' })).toBeTruthy()
})

it('plays every item in a YouTube playlist before advancing to the next item', async () => {
  let config: any
  let player: any
  let playlistIndex = 0
  vi.stubGlobal('YT', {
    PlayerState: { ENDED: 0, PLAYING: 1 },
    Player: class {
      constructor(_host: HTMLElement, options: any) { config = options; player = this }
      getIframe() { return document.createElement('iframe') }
      mute() {}
      playVideo() {}
      destroy() {}
      seekTo() {}
      getPlaylist() { return ['first', 'second'] }
      getPlaylistIndex() { return playlistIndex }
    },
  })
  const state: TvState = {
    organization_name: 'Clinic', logo_url: null, brand_color: null, language: 'ru',
    is_hall_screen: true, queues: [], recent_calls: [], timezone: 'Asia/Almaty', display_mode: 'media',
    slide_seconds: 5, ads_enabled: true, departments: [],
    media: [
      { id: 'list', title: 'Плейлист', kind: 'youtube_playlist', mime_type: 'text/youtube', url: 'https://www.youtube.com/embed?listType=playlist&list=PL1234567890' },
      { id: 'poster', title: 'Объявление', kind: 'advertisement', mime_type: 'image/png', url: '/api/tv/media/poster' },
    ],
  }
  render(<MediaView state={state} />)
  await act(async () => {})
  expect(config.playerVars.list).toBe('PL1234567890')
  act(() => config.events.onStateChange({ target: player, data: 0 }))
  expect(screen.queryByRole('img', { name: 'Объявление' })).toBeNull()
  playlistIndex = 1
  act(() => config.events.onStateChange({ target: player, data: 0 }))
  expect(screen.getByRole('img', { name: 'Объявление' })).toBeTruthy()
})
