import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import { attendanceApi } from '../../api/attendance'
import type { AttendanceEvent } from '../../api/attendance'
import { ApiError } from '../../api/client'
import { useAttendanceCamera } from '../../hooks/useAttendanceCamera'
import { attendanceRepeatMessage } from '../../lib/attendanceRepeat'
import '../admin/attendance.css'

function kioskError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Камера недоступна. Разрешите доступ к ней и попробуйте ещё раз.'
  if (error.code === 'face_not_recognized') return 'Не удалось уверенно узнать сотрудника. Обратитесь к администратору.'
  if (error.code === 'attendance_too_soon') return attendanceRepeatMessage(error)
  if (error.code === 'face_count_invalid') return 'В кадре должен быть только один человек.'
  if (error.code === 'face_too_small') return 'Подойдите ближе к камере.'
  if (error.code === 'face_capture_inconsistent') return 'Не удалось уверенно распознать лицо. Посмотрите прямо в камеру и повторите.'
  return 'Не удалось создать отметку. Попробуйте ещё раз.'
}

export default function AttendanceKioskPage() {
  const [token, setToken] = useState(() => window.localStorage.getItem('attendance.kioskToken') || '')
  const [verified, setVerified] = useState(false)
  const [code, setCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [pairError, setPairError] = useState('')

  const unpair = useCallback(() => {
    window.localStorage.removeItem('attendance.kioskToken')
    setToken('')
    setVerified(false)
  }, [])

  useEffect(() => {
    if (!token) return
    let active = true
    void attendanceApi.kioskState(token).then(() => { if (active) { setVerified(true); setPairError('') } }).catch((error) => {
      if (!active) return
      if (error instanceof ApiError && error.status === 401) unpair()
      else setPairError('Нет связи с сервером. Проверьте интернет и обновите страницу.')
    })
    const interval = window.setInterval(() => {
      void attendanceApi.kioskState(token).catch((error) => {
        if (active && error instanceof ApiError && error.status === 401) unpair()
      })
    }, 30_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [token, unpair])

  async function pair(event: React.FormEvent) {
    event.preventDefault()
    setPairing(true); setPairError('')
    try {
      const result = await attendanceApi.pairKiosk(code)
      window.localStorage.setItem('attendance.kioskToken', result.device_token)
      setToken(result.device_token)
      setCode('')
    } catch (error) {
      setPairError(error instanceof ApiError && error.status === 429 ? 'Слишком много попыток. Повторите через минуту.' : 'Неверный или уже использованный код подключения.')
    } finally { setPairing(false) }
  }

  if (!token) return <main className="attendance-kiosk attendance-kiosk--pair"><div className="attendance-kiosk__pair-card">
    <span className="attendance-kiosk__brand"><span className="attendance-kiosk__mark">+</span> omnibook</span>
    <h1>Подключение стойки</h1>
    <p>Администратор создаёт стойку в разделе «Учёт рабочего времени → Настройки и стойки». Введите её шестизначный код здесь.</p>
    <form onSubmit={(event) => void pair(event)}><label>Код подключения<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required autoFocus /></label><button type="submit" disabled={pairing || code.length !== 6}>{pairing ? 'Подключаем…' : 'Подключить стойку'}</button></form>
    {pairError && <p className="attendance-kiosk__error" role="alert">{pairError}</p>}
  </div></main>
  if (!verified) return <main className="attendance-kiosk attendance-kiosk--pair"><div className="attendance-kiosk__pair-card"><h1>Проверяем подключение…</h1>{pairError && <><p className="attendance-kiosk__error" role="alert">{pairError}</p><button type="button" onClick={() => window.location.reload()}>Повторить</button></>}</div></main>
  return <AttendanceKioskScreen token={token} onUnpaired={unpair} />
}

function AttendanceKioskScreen({ token, onUnpaired }: { token: string; onUnpaired: () => void }) {
  const [qr, setQr] = useState('')
  const [enrollmentQr, setEnrollmentQr] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [result, setResult] = useState<AttendanceEvent | null>(null)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const [clock, setClock] = useState(new Date())
  const { videoRef, cameraActive, capture } = useAttendanceCamera()

  useEffect(() => {
    let active = true
    const updateQr = async () => {
      try {
        const response = await attendanceApi.kioskQr(token)
        const url = `${window.location.origin}/attendance/phone?token=${encodeURIComponent(response.token)}`
        const image = await QRCode.toDataURL(url, { width: 340, margin: 1, errorCorrectionLevel: 'M' })
        if (active) setQr(image)
      } catch (error) { if (active) { setQr(''); if (error instanceof ApiError && error.status === 401) onUnpaired() } }
    }
    void updateQr()
    const interval = window.setInterval(() => { void updateQr() }, 15_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [token, onUnpaired])

  useEffect(() => {
    let active = true
    const update = async () => {
      try {
        const response = await attendanceApi.kioskEnrollmentQr(token)
        const image = response.token ? await QRCode.toDataURL(`${window.location.origin}/attendance/enroll?token=${encodeURIComponent(response.token)}`, { width: 280, margin: 1 }) : ''
        if (active) setEnrollmentQr(image)
      } catch (error) { if (active) { setEnrollmentQr(''); if (error instanceof ApiError && error.status === 401) onUnpaired() } }
    }
    void update()
    const interval = window.setInterval(() => { void update() }, 60_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [token, onUnpaired])

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!result && !error) return undefined
    const timeout = window.setTimeout(() => { setResult(null); setError(null) }, error ? 8000 : 5000)
    return () => window.clearTimeout(timeout)
  }, [result, error])

  const mark = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(null); setResult(null)
    try {
      const images = await capture()
      setResult(await attendanceApi.kioskMark(token, images))
    }
    catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnpaired()
      else setError({
        title: err instanceof ApiError && err.code === 'attendance_too_soon' ? 'Повторная отметка' : 'Не удалось отметиться',
        message: kioskError(err),
      })
    }
    finally { busyRef.current = false; setBusy(false) }
  }, [capture, token, onUnpaired])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return
      event.preventDefault()
      void mark()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mark])

  return <main className={`attendance-kiosk${busy ? ' attendance-kiosk--scanning' : ''}${error ? ' attendance-kiosk--feedback' : ''}`}>
    <header className="attendance-kiosk__header"><div className="attendance-kiosk__brand"><span className="attendance-kiosk__mark">+</span> omni<span>book</span></div><time>{clock.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}<small>{clock.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</small></time></header>
    <div className="attendance-kiosk__body"><section className="attendance-kiosk__main">
      {result ? <div className="attendance-kiosk__result" role="status"><span>{result.kind === 'in' ? 'Приход подтверждён' : 'Уход подтверждён'}</span><strong>{result.employee_name}</strong><time>{new Date(result.occurred_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time><p>{result.kind === 'in' ? 'Для ухода снова нажмите пробел не раньше чем через 2 минуты' : 'Следующий сотрудник может нажать пробел'}</p></div> : error ? <div className="attendance-kiosk__feedback" role="alert"><span>Отметка не добавлена</span><h1>{error.title}</h1><p>{error.message}</p><button type="button" onClick={() => setError(null)}>Понятно</button></div> : busy ? <div className="attendance-kiosk__scanning" role="status" aria-live="polite"><h1>Сверяем лицо…</h1><p>Смотрите прямо в камеру. Двигаться не нужно.</p></div> : <><h1>Отметьтесь<br />на работе</h1><p>Подойдите к камере и один раз нажмите пробел.</p><p>Первый скан — приход. Повторный через 2 минуты — уход.</p><button type="button" className="attendance-kiosk__space" onClick={() => void mark()} disabled={busy}>Пробел — начать</button></>}
      <video ref={videoRef} className={`attendance-kiosk__video ${cameraActive ? 'is-active' : ''}`} autoPlay muted playsInline aria-label="Изображение с камеры" />
    </section><aside className={`attendance-kiosk__qr${enrollmentQr ? ' attendance-kiosk__qr--with-enrollment' : ''}`}><p>Отметиться со своего телефона</p>{qr ? <img src={qr} alt="QR-код для отметки через телефон" /> : <div className="attendance-kiosk__qr-empty">QR сейчас недоступен</div>}<span>Сканируйте код и введите личный код сотрудника</span>{enrollmentQr && <div className="attendance-kiosk__enrollment"><p>Первичная регистрация лица</p><img src={enrollmentQr} alt="QR-код регистрации лица" /><span>После отправки администратор подтвердит личность</span></div>}</aside></div>
  </main>
}
