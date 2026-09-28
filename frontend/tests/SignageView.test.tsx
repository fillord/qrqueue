import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

it('rotates media independently and never overlays its title', () => {
  vi.useFakeTimers()
  const state: TvState = {
    organization_name: 'Clinic', logo_url: null, brand_color: null, language: 'ru',
    is_hall_screen: true, queues: [], recent_calls: [], timezone: 'Asia/Almaty', display_mode: 'media',
    slide_seconds: 5, ads_enabled: true, departments: [],
    media: [
      { id: 'poster', title: 'Объявление', kind: 'advertisement', mime_type: 'image/png', url: '/api/tv/media/poster' },
      { id: 'film', title: 'Ролик', kind: 'video', mime_type: 'video/mp4', url: '/api/tv/media/film' },
    ],
  }
  const { container } = render(<MediaView state={state} />)
  expect(screen.getByRole('img', { name: 'Объявление' })).toBeTruthy()
  expect(screen.queryByText('Объявление')).toBeNull()
  act(() => vi.advanceTimersByTime(5000))
  expect(container.querySelector('video')).toBeNull()
  act(() => vi.advanceTimersByTime(500))
  const video = container.querySelector('video.tv-media__foreground')
  expect(video?.getAttribute('src')).toBe('/api/tv/media/film')
  expect(container.querySelectorAll('video')).toHaveLength(1)
  expect(screen.queryByText('Ролик')).toBeNull()
  act(() => vi.advanceTimersByTime(15_000))
  expect(container.querySelector('video.tv-media__foreground')?.getAttribute('src')).toBe('/api/tv/media/film')
  fireEvent.ended(video!)
  expect(container.querySelector('video')).toBeNull()
  act(() => vi.advanceTimersByTime(500))
  expect(screen.getByRole('img', { name: 'Объявление' })).toBeTruthy()
})

it('plays every video in order and releases the decoder between clips', () => {
  vi.useFakeTimers()
  const state: TvState = {
    organization_name: 'Clinic', logo_url: null, brand_color: null, language: 'ru',
    is_hall_screen: true, queues: [], recent_calls: [], timezone: 'Asia/Almaty', display_mode: 'media',
    slide_seconds: 5, ads_enabled: false, departments: [],
    media: [
      { id: 'first', title: 'First', kind: 'video', mime_type: 'video/mp4', url: '/api/tv/media/first' },
      { id: 'second', title: 'Second', kind: 'video', mime_type: 'video/mp4', url: '/api/tv/media/second' },
    ],
  }
  const { container, rerender } = render(<MediaView state={state} />)
  expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/tv/media/first')
  fireEvent.ended(container.querySelector('video')!)
  expect(container.querySelector('video')).toBeNull()
  act(() => vi.advanceTimersByTime(500))
  expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/tv/media/second')
  rerender(<MediaView state={{ ...state, media: state.media.map((item) => ({ ...item })) }} />)
  expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/tv/media/second')
  fireEvent.ended(container.querySelector('video')!)
  act(() => vi.advanceTimersByTime(500))
  expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/tv/media/first')
  expect(container.querySelectorAll('video')).toHaveLength(1)
})

it('retries a video that fails once while rotating all videos', () => {
  vi.useFakeTimers()
  const state: TvState = {
    organization_name: 'Clinic', logo_url: null, brand_color: null, language: 'ru',
    is_hall_screen: true, queues: [], recent_calls: [], timezone: 'Asia/Almaty', display_mode: 'media',
    slide_seconds: 5, ads_enabled: false, departments: [],
    media: [
      { id: 'first', title: 'First', kind: 'video', mime_type: 'video/mp4', url: '/api/tv/media/first' },
      { id: 'second', title: 'Second', kind: 'video', mime_type: 'video/mp4', url: '/api/tv/media/second' },
    ],
  }
  const { container } = render(<MediaView state={state} />)
  fireEvent.ended(container.querySelector('video')!)
  act(() => vi.advanceTimersByTime(500))
  expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/tv/media/second')
  fireEvent.error(container.querySelector('video')!)
  act(() => vi.advanceTimersByTime(500))
  expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/tv/media/first')
  act(() => vi.advanceTimersByTime(30_000))
  expect(container.querySelector('video')).toBeNull()
  act(() => vi.advanceTimersByTime(500))
  expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/tv/media/second')
})

it('replays one video continuously using a single TV decoder', () => {
  vi.useFakeTimers()
  const state: TvState = {
    organization_name: 'Clinic', logo_url: null, brand_color: null, language: 'ru',
    is_hall_screen: true, queues: [], recent_calls: [], timezone: 'Asia/Almaty', display_mode: 'media',
    slide_seconds: 5, ads_enabled: false, departments: [],
    media: [{ id: 'vertical', title: 'Vertical', kind: 'video', mime_type: 'video/mp4', url: '/api/tv/media/vertical' }],
  }
  const { container } = render(<MediaView state={state} />)
  const foreground = container.querySelector<HTMLVideoElement>('video.tv-media__foreground')
  expect(foreground?.src).toContain('/api/tv/media/vertical')
  expect(container.querySelectorAll('video')).toHaveLength(1)
  act(() => vi.advanceTimersByTime(4000))
  fireEvent.ended(foreground!)
  expect(container.querySelector('video')).toBe(foreground)
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
})
