import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ApiError } from '../src/api/client'
import { attendanceApi } from '../src/api/attendance'
import AttendanceKioskPage from '../src/pages/attendance/AttendanceKioskPage'

vi.mock('../src/api/attendance', () => ({
  attendanceApi: {
    kioskState: vi.fn(), kioskQr: vi.fn(), kioskEnrollmentQr: vi.fn(), kioskMark: vi.fn(), pairKiosk: vi.fn(),
  },
}))
vi.mock('../src/hooks/useAttendanceCamera', () => ({
  useAttendanceCamera: () => ({ videoRef: { current: null }, cameraActive: false, capture: async () => ['frame-a', 'frame-b'] }),
}))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AA==' } }))

beforeEach(() => {
  window.localStorage.setItem('attendance.kioskToken', 'paired-token')
  vi.mocked(attendanceApi.kioskState).mockResolvedValue({ name: 'Стойка' })
  vi.mocked(attendanceApi.kioskQr).mockResolvedValue({ token: 'qr-token', expires_in: 45 })
  vi.mocked(attendanceApi.kioskEnrollmentQr).mockResolvedValue({ token: null })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear() })

it('replaces the idle screen with a visible repeat-scan notice', async () => {
  vi.mocked(attendanceApi.kioskMark).mockRejectedValue(new ApiError(409, 'attendance_too_soon', undefined, undefined, {
    lastKind: 'in', retryAt: '2026-09-27T10:30:00+05:00', employeeName: 'Айгуль Садыкова',
  }))
  render(<AttendanceKioskPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Пробел — начать' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Айгуль Садыкова: приход уже отмечен')
  expect(alert.textContent).toContain('Уход можно зафиксировать после')
  expect(screen.queryByRole('heading', { name: /Отметьтесь/ })).toBeNull()
  expect(alert.closest('.attendance-kiosk__main')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Понятно' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Пробел — начать' })).toBeTruthy())
})
