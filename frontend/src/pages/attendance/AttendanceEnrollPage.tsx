import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { attendanceApi } from '../../api/attendance'
import { useAttendanceCamera } from '../../hooks/useAttendanceCamera'
import '../admin/attendance.css'

function message(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Не удалось открыть камеру. Проверьте разрешение браузера.'
  if (error.code === 'enrollment_link_invalid') return 'Ссылка для регистрации недействительна. Попросите новый QR-код у администратора.'
  if (error.code === 'enrollment_not_available') return 'Код не найден или регистрация лица уже выполнена. Обратитесь к администратору.'
  if (error.code === 'rate_limited') return 'Слишком много попыток. Повторите позже.'
  if (error.code === 'face_count_invalid') return 'В кадре должно быть только ваше лицо.'
  if (error.code === 'face_too_small') return 'Подойдите ближе к камере.'
  return 'Не удалось отправить снимки. Попробуйте ещё раз.'
}

export default function AttendanceEnrollPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [organizationName, setOrganizationName] = useState('')
  const [code, setCode] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { videoRef, cameraActive, startPreview, stopPreview, capture } = useAttendanceCamera()

  async function showCamera() {
    setError(null)
    try { await startPreview() }
    catch (err) { setError(message(err)) }
  }

  useEffect(() => {
    if (!token) { setError('Сканируйте QR-код регистрации лица.'); return }
    void attendanceApi.enrollmentContext(token).then((context) => setOrganizationName(context.organization_name)).catch((err) => setError(message(err)))
  }, [token])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!organizationName || !/^\d{4}$/.test(code) || !consent || !cameraActive || busy) return
    setBusy(true); setError(null)
    try { setDone((await attendanceApi.submitEnrollment(token, code, await capture())).employee_name) }
    catch (err) { setError(message(err)) }
    finally { setBusy(false) }
  }

  return <main className="attendance-phone">
    <div className="attendance-phone__eyebrow">Регистрация лица · {organizationName || 'Проверяем ссылку…'}</div>
    {done ? <section className="attendance-phone__done" role="status"><span className="attendance-phone__done-mark">✓</span><h1>Заявка отправлена</h1><p>{done}</p><small>Администратор подтвердит личность при встрече. После подтверждения можно отмечать приход и уход.</small></section> : <>
      <h1>Зарегистрировать<br />лицо</h1>
      <p className="attendance-phone__intro">Введите личный код, включите камеру и разместите лицо целиком в кадре. Администратор сравнит снимок с вами лично.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>Личный код<input inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" maxLength={4} placeholder="4 цифры" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))} required /></label>
        <div className="attendance-phone__camera"><video ref={videoRef} autoPlay muted playsInline className={cameraActive ? 'is-active' : ''} /><p>{cameraActive ? 'Разместите лицо целиком в кадре и посмотрите прямо в камеру' : 'Сначала включите камеру и проверьте кадр'}</p></div>
        <button type="button" className="attendance-preview-button" onClick={() => cameraActive ? stopPreview() : void showCamera()} disabled={busy}>{cameraActive ? 'Выключить камеру' : 'Включить камеру и проверить кадр'}</button>
        <label className="attendance-enroll__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Я согласен на обработку биометрических данных и временное хранение снимка лица до решения администратора</label>
        <button disabled={!organizationName || code.length !== 4 || !consent || !cameraActive || busy}>{busy ? 'Отправляем…' : 'Отправить на подтверждение'}</button>
      </form>
      {error && <p className="attendance-phone__error" role="alert">{error}</p>}
    </>}
  </main>
}
