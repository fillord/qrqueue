import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { attendanceApi } from '../../api/attendance'
import type { AttendanceEvent } from '../../api/attendance'
import { useAttendanceCamera } from '../../hooks/useAttendanceCamera'
import { attendanceRepeatMessage } from '../../lib/attendanceRepeat'
import { getAttendanceLocation } from '../../lib/attendanceLocation'
import '../admin/attendance.css'

function phoneError(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : 'Не удалось открыть камеру. Проверьте разрешение браузера.'
  if (error.code === 'attendance_qr_expired') return 'Время QR-кода истекло. Сканируйте код у стойки ещё раз.'
  if (error.code === 'face_not_recognized') return 'Лицо не совпало с личным кодом. Проверьте код и повторите.'
  if (error.code === 'attendance_too_soon') return attendanceRepeatMessage(error)
  if (error.code === 'face_count_invalid') return 'В кадре должно быть только ваше лицо.'
  if (error.code === 'face_too_small') return 'Поднесите телефон немного ближе.'
  if (error.code === 'rate_limited') return 'Слишком много попыток. Попробуйте позже.'
  if (error.code === 'face_capture_inconsistent') return 'Не удалось уверенно распознать лицо. Посмотрите прямо в камеру и повторите.'
  if (error.code === 'attendance_geo_required') return 'Для отметки включите геопозицию на телефоне и повторите.'
  if (error.code === 'attendance_geo_inaccurate') return 'Местоположение определено слишком неточно. Подойдите к окну или включите точную геолокацию.'
  if (error.code === 'attendance_geo_out_of_range') return 'Отметка с телефона доступна только рядом с местом работы.'
  return 'Отметка не создана. Проверьте камеру и попробуйте снова.'
}

export default function AttendancePhonePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [organizationName, setOrganizationName] = useState('')
  const [sessionToken, setSessionToken] = useState('')
  const [geoRequired, setGeoRequired] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AttendanceEvent | null>(null)
  const { videoRef, cameraActive, startPreview, stopPreview, capture } = useAttendanceCamera()

  async function showCamera() {
    setError(null)
    try { await startPreview() }
    catch (err) { setError(phoneError(err)) }
  }

  useEffect(() => {
    if (!token) { setError('Сканируйте QR-код у стойки, чтобы открыть отметку.'); return }
    void attendanceApi.phoneContext(token).then((context) => { setOrganizationName(context.organization_name); setSessionToken(context.session_token); setGeoRequired(context.geo_required) }).catch((err) => setError(phoneError(err)))
  }, [token])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!sessionToken || !/^(\d{4}|\d{10})$/.test(code) || busy) return
    setBusy(true); setError(null)
    try {
      const location = geoRequired ? await getAttendanceLocation() : undefined
      const images = await capture()
      setResult(await attendanceApi.phoneMark(sessionToken, code, images, location))
    }
    catch (err) { setError(phoneError(err)) }
    finally { setBusy(false) }
  }

  return <main className="attendance-phone">
    <div className="attendance-phone__eyebrow">Учёт рабочего времени</div>
    {result ? <section className="attendance-phone__done" role="status"><span className="attendance-phone__done-mark">✓</span><h1>{result.kind === 'in' ? 'Приход подтверждён' : 'Уход подтверждён'}</h1><p>{result.employee_name}</p><strong>{new Date(result.occurred_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</strong><small>{result.kind === 'in' ? 'Для ухода снова отсканируйте QR у стойки не раньше чем через 2 минуты.' : 'Отметка ухода сохранена.'}</small></section> : <><h1>Отметиться<br />на работе</h1><p className="attendance-phone__intro">{organizationName || 'Проверяем QR-код…'}</p>{geoRequired && <p className="attendance-phone__geo-note">📍 Для отметки нужно находиться рядом с местом работы. Телефон запросит доступ к геопозиции.</p>}<form onSubmit={(event) => void submit(event)}><label>Личный код сотрудника<input inputMode="numeric" autoComplete="off" pattern="([0-9]{4}|[0-9]{10})" maxLength={10} placeholder="4 цифры" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))} required disabled={busy} /></label><div className="attendance-phone__camera"><video ref={videoRef} autoPlay muted playsInline className={cameraActive ? 'is-active' : ''} /><p>{cameraActive ? 'Проверьте, что лицо целиком видно в кадре' : 'Включите камеру и проверьте кадр перед отметкой'}</p></div><button type="button" className="attendance-preview-button" onClick={() => cameraActive ? stopPreview() : void showCamera()} disabled={busy}>{cameraActive ? 'Выключить камеру' : 'Включить камеру и проверить кадр'}</button><button disabled={!sessionToken || !/^(\d{4}|\d{10})$/.test(code) || busy}>{busy ? 'Проверяем место и лицо…' : 'Сверить лицо и отметиться'}</button></form>{error && <p className="attendance-phone__error" role="alert">{error}</p>}<small>Для ранее созданного сотрудника старый 10-значный код действует до замены администратором.</small></>}
  </main>
}
