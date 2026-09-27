import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { attendanceRepeatMessage } from '../src/lib/attendanceRepeat'

describe('attendance repeat message', () => {
  it('explains when a second scan can record departure', () => {
    const error = new ApiError(409, 'attendance_too_soon', undefined, undefined, {
      lastKind: 'in', retryAt: '2026-09-27T10:30:00+05:00', employeeName: 'Айгуль Садыкова',
    })
    const message = attendanceRepeatMessage(error)
    expect(message).toContain('Айгуль Садыкова: приход уже отмечен')
    expect(message).toContain('Уход можно зафиксировать после')
  })

  it('explains that a repeated departure does not create a new arrival', () => {
    const error = new ApiError(409, 'attendance_too_soon', undefined, undefined, { lastKind: 'out' })
    expect(attendanceRepeatMessage(error)).toContain('уход уже отмечен. Новую отметку можно зафиксировать через две минуты')
  })
})
