import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { TvDepartmentState, TvState } from '../../api/types'
import { groupDoctorSchedule } from '../../lib/doctorSchedule'
import type { DoctorScheduleRow } from '../../lib/doctorSchedule'

type Slide = { key: string; department: TvDepartmentState; rows: DoctorScheduleRow[]; page: number; pages: number }
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

function weekdayIn(timezone: string, date: Date): number {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date)
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(day)
}

function makeSlides(state: TvState, rowsPerPage: number): Slide[] {
  const slides: Slide[] = []
  for (const department of state.departments) {
    const rows = groupDoctorSchedule(department.entries)
    const pages: DoctorScheduleRow[][] = []
    if (rows.length === 0) pages.push([])
    for (let rowStart = 0; rowStart < rows.length; rowStart += rowsPerPage) {
      pages.push(rows.slice(rowStart, rowStart + rowsPerPage))
    }
    for (let page = 0; page < pages.length; page += 1) {
      slides.push({ key: `department-${department.id}-${page}`, department,
        rows: pages[page], page, pages: pages.length })
    }
  }
  return slides
}

export default function ScheduleView({ state }: { state: TvState }) {
  const { t, i18n } = useTranslation()
  const [now, setNow] = useState(() => new Date())
  const [slideIndex, setSlideIndex] = useState(0)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(0)
  const today = weekdayIn(state.timezone, now)
  const fallbackHeight = viewport.height - 220
  const rowMinHeight = viewport.width < 1100 ? 80 : 72
  const rowsPerPage = Math.max(1, Math.floor(((tableHeight || fallbackHeight) - 52) / rowMinHeight))
  const programKey = JSON.stringify(state.departments)
  const slides = useMemo(() => makeSlides(state, rowsPerPage), [programKey, rowsPerPage])
  const slide = slides[slideIndex % slides.length]
  const slideKey = slide?.key

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => {
    const element = tableWrapRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setTableHeight(element.clientHeight))
    observer.observe(element)
    setTableHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [slideKey])

  useEffect(() => { setSlideIndex(0) }, [programKey, rowsPerPage])
  useEffect(() => {
    if (!slide) return
    const timer = window.setTimeout(() => setSlideIndex((index) => index + 1), state.slide_seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [slideKey, state.slide_seconds])

  const time = new Intl.DateTimeFormat(i18n.language, { timeZone: state.timezone, hour: '2-digit', minute: '2-digit' }).format(now)
  const date = new Intl.DateTimeFormat(i18n.language, { timeZone: state.timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(now)
  const visibleRows = Math.max(1, slide?.rows.length ?? 1)
  const tableFontRem = Math.max(.78, Math.min(2.3, 3.9 / Math.sqrt(visibleRows), viewport.width / 750))
  const tableStyle = { '--schedule-rows': visibleRows, fontSize: `${tableFontRem}rem` } as CSSProperties

  return <div className="tv-signage">
    <div className="tv-signage__meta"><span>{t('signage.weekSchedule')}</span><span className="tv-signage__datetime">{date}<time>{time}</time></span></div>
    {!slide ? <div className="tv-signage__empty">{t('signage.noScheduleContent')}</div> : (
      <section className="tv-signage__schedule" key={slide.key}>
        <div className="tv-signage__heading"><h1>{slide.department.name}</h1>
          {slide.pages > 1 && <span className="tv-signage__page">{slide.page + 1} / {slide.pages}</span>}
        </div>
        <div className="tv-signage__table-wrap" ref={tableWrapRef}><table className="tv-signage__table" style={tableStyle} aria-label={t('signage.scheduleFor', { name: slide.department.name })}>
          <thead><tr><th>{t('signage.doctor')}</th><th>{t('signage.specialty')}</th><th>{t('signage.room')}</th>
            {WEEKDAYS.map((weekday) => <th className={weekday === today ? 'tv-signage__today' : ''} key={weekday}>{t(`signage.shortWeekdays.${weekday}`)}</th>)}
          </tr></thead>
          <tbody>{slide.rows.length ? slide.rows.map((row) => <tr key={row.key}>
            <td className="tv-signage__doctor">{row.doctor}</td><td>{row.service || '—'}</td><td>{row.room || '—'}</td>
            {WEEKDAYS.map((weekday) => <td className={weekday === today ? 'tv-signage__today' : ''} key={weekday}>
              {row.days[weekday].length ? row.days[weekday].map((slot) => <span className="tv-signage__slot" key={slot.id}><span>{slot.starts_at.slice(0, 5)}</span><span className="tv-signage__slot-dash">–</span><span>{slot.ends_at.slice(0, 5)}</span></span>) : '—'}
            </td>)}
          </tr>) : <tr><td colSpan={10} className="tv-signage__no-appointments">{t('signage.noAppointments')}</td></tr>}</tbody>
        </table></div>
      </section>
    )}
  </div>
}
