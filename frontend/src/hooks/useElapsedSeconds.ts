import { useEffect, useState } from 'react'

/** Ticks once a second so callers re-render; returns seconds since `sinceIso`, or null. */
export function useElapsedSeconds(sinceIso: string | null): number | null {
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (!sinceIso) return undefined
    const interval = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(interval)
  }, [sinceIso])

  if (!sinceIso) return null
  return Math.max(0, Math.floor((Date.now() - new Date(sinceIso).getTime()) / 1000))
}
