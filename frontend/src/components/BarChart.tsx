import { useEffect, useRef } from 'react'

export interface BarChartDatum {
  label: string
  value: number
}

/**
 * Plain <canvas> bar chart — no charting library, matches "не добавлять
 * новых зависимостей без необходимости". Redraws on every prop change and
 * on resize (canvas has no intrinsic responsiveness of its own).
 */
export default function BarChart({ data, height = 160 }: { data: BarChartDatum[]; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function draw() {
      const ctx = canvas!.getContext('2d')
      if (!ctx) return

      const dpr = window.devicePixelRatio || 1
      const width = canvas!.clientWidth || 1
      canvas!.width = width * dpr
      canvas!.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const styles = getComputedStyle(document.documentElement)
      const barColor = styles.getPropertyValue('--color-primary').trim() || '#2563eb'
      const textColor = styles.getPropertyValue('--color-muted').trim() || '#666'

      const max = Math.max(1, ...data.map((d) => d.value))
      const bottomPadding = 18
      const plotHeight = height - bottomPadding
      const barWidth = width / Math.max(1, data.length)
      const labelEvery = data.length > 16 ? 3 : 1

      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'

      data.forEach((d, i) => {
        const barHeight = (plotHeight * d.value) / max
        const x = i * barWidth
        ctx.fillStyle = d.value > 0 ? barColor : 'transparent'
        ctx.fillRect(x + 1, plotHeight - barHeight, Math.max(1, barWidth - 2), barHeight)

        if (i % labelEvery === 0) {
          ctx.fillStyle = textColor
          ctx.fillText(d.label, x + barWidth / 2, height - 4)
        }
      })
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [data, height])

  return <canvas ref={canvasRef} className="bar-chart" style={{ height }} />
}
