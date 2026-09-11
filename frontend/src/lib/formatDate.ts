export function formatDateTimeInTimezone(isoString: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(isoString))
  } catch {
    return new Date(isoString).toLocaleString()
  }
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function defaultDateRange(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - (days - 1))
  return { from: isoDate(from), to: isoDate(to) }
}
