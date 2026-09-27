import type { ApiError } from '../api/client'

export function attendanceRepeatMessage(error: ApiError): string {
  const name = error.employeeName ? `${error.employeeName}: ` : ''
  const lastMark = error.lastKind === 'in' ? 'приход уже отмечен' : error.lastKind === 'out' ? 'уход уже отмечен' : 'отметка уже сделана'
  const nextMark = error.lastKind === 'in' ? 'Уход' : 'Новую отметку'
  const retry = error.retryAt ? new Date(error.retryAt) : null
  const when = retry && !Number.isNaN(retry.getTime())
    ? `после ${retry.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    : 'через две минуты'
  return `${name}${lastMark}. ${nextMark} можно зафиксировать ${when}.`
}
