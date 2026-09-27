import { useEffect, useRef, useState } from 'react'

const pause = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))

export function useAttendanceCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraActive, setCameraActive] = useState(false)

  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null }, [])

  function stopPreview() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraActive(false)
  }

  async function startPreview() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera_unavailable')
    const video = videoRef.current
    if (!video) throw new Error('camera_unavailable')
    if (!streamRef.current) streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
    try {
      video.srcObject = streamRef.current
      await video.play()
      for (let i = 0; video.videoWidth < 240 && i < 30; i += 1) await pause(100)
      if (video.videoWidth < 240) throw new Error('camera_unavailable')
      setCameraActive(true)
    } catch (error) {
      stopPreview()
      throw error
    }
  }

  async function capture(): Promise<string[]> {
    const video = videoRef.current
    if (!video) throw new Error('camera_unavailable')
    await startPreview()
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('camera_unavailable')
      const frame = () => {
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        return canvas.toDataURL('image/jpeg', 0.82).split(',')[1]
      }
      await pause(250)
      const first = frame()
      await pause(550)
      return [first, frame()]
    } finally {
      stopPreview()
    }
  }

  return { videoRef, cameraActive, startPreview, stopPreview, capture }
}
