export interface AttendanceLocation {
  latitude: number
  longitude: number
  accuracy_m: number
}

export function getAttendanceLocation(): Promise<AttendanceLocation> {
  if (!window.isSecureContext || !navigator.geolocation) {
    return Promise.reject(new Error('Геопозиция недоступна. Откройте защищённую страницу HTTPS на телефоне.'))
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy_m: coords.accuracy,
      }),
      (error) => reject(new Error(error.code === 1
        ? 'Разрешите доступ к геопозиции в браузере и повторите.'
        : 'Не удалось определить точное местоположение. Включите геолокацию и попробуйте снова.')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
    )
  })
}
