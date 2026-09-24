import type { TvScheduleEntry } from '../api/types'

export interface DoctorScheduleRow {
  key: string
  doctor: string
  service: string | null
  room: string | null
  days: TvScheduleEntry[][]
  sortOrder: number
}

export function groupDoctorSchedule(entries: TvScheduleEntry[]): DoctorScheduleRow[] {
  const rows = new Map<string, DoctorScheduleRow>()
  for (const entry of entries) {
    const key = JSON.stringify([entry.doctor_name, entry.service_name, entry.room])
    let row = rows.get(key)
    if (!row) {
      row = { key, doctor: entry.doctor_name, service: entry.service_name, room: entry.room,
        days: Array.from({ length: 7 }, () => []), sortOrder: entry.sort_order }
      rows.set(key, row)
    }
    row.sortOrder = Math.min(row.sortOrder, entry.sort_order)
    row.days[entry.weekday].push(entry)
  }
  for (const row of rows.values()) {
    for (const day of row.days) day.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.sort_order - b.sort_order)
  }
  return [...rows.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.doctor.localeCompare(b.doctor))
}
