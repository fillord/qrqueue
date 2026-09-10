import { useCallback, useRef, useState } from 'react'

const TOAST_LIFETIME_MS = 4000

export interface ToastMessage {
  id: number
  text: string
}

export interface UseToastsResult {
  toasts: ToastMessage[]
  push: (text: string) => void
  dismiss: (id: number) => void
}

export function useToasts(): UseToastsResult {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const idRef = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (text: string) => {
      const id = ++idRef.current
      setToasts((prev) => [...prev, { id, text }])
      setTimeout(() => dismiss(id), TOAST_LIFETIME_MS)
    },
    [dismiss],
  )

  return { toasts, push, dismiss }
}
