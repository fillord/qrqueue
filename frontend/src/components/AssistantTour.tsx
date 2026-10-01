import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { AssistantTourStep } from '../lib/assistantGuidance'

type HighlightRect = { top: number; right: number; bottom: number; left: number; width: number; height: number }
type TooltipSize = { width: number; height: number }
type TooltipPlacement = 'above' | 'below' | 'left' | 'right' | 'center'

const VIEWPORT_MARGIN = 12
const TARGET_GAP = 14

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

export function getTooltipLayout(rect: HighlightRect | null, size: TooltipSize, viewport: TooltipSize): {
  placement: TooltipPlacement
  left: number
  top: number
} {
  const width = Math.min(size.width, viewport.width - VIEWPORT_MARGIN * 2)
  const height = Math.min(size.height, viewport.height - VIEWPORT_MARGIN * 2)
  const maxLeft = viewport.width - width - VIEWPORT_MARGIN
  const maxTop = viewport.height - height - VIEWPORT_MARGIN

  if (!rect) {
    return {
      placement: 'center',
      left: clamp((viewport.width - width) / 2, VIEWPORT_MARGIN, maxLeft),
      top: clamp((viewport.height - height) / 2, VIEWPORT_MARGIN, maxTop),
    }
  }

  const spaces = {
    below: viewport.height - rect.bottom - TARGET_GAP - VIEWPORT_MARGIN,
    above: rect.top - TARGET_GAP - VIEWPORT_MARGIN,
    right: viewport.width - rect.right - TARGET_GAP - VIEWPORT_MARGIN,
    left: rect.left - TARGET_GAP - VIEWPORT_MARGIN,
  }
  let placement: TooltipPlacement
  if (spaces.below >= height) placement = 'below'
  else if (spaces.above >= height) placement = 'above'
  else if (spaces.right >= width) placement = 'right'
  else if (spaces.left >= width) placement = 'left'
  else {
    placement = (Object.entries(spaces) as Array<[Exclude<TooltipPlacement, 'center'>, number]>)
      .sort((a, b) => b[1] - a[1])[0][0]
  }

  if (placement === 'below' || placement === 'above') {
    return {
      placement,
      left: clamp(rect.left, VIEWPORT_MARGIN, maxLeft),
      top: clamp(
        placement === 'below' ? rect.bottom + TARGET_GAP : rect.top - TARGET_GAP - height,
        VIEWPORT_MARGIN,
        maxTop,
      ),
    }
  }
  return {
    placement,
    left: clamp(
      placement === 'right' ? rect.right + TARGET_GAP : rect.left - TARGET_GAP - width,
      VIEWPORT_MARGIN,
      maxLeft,
    ),
    top: clamp(rect.top, VIEWPORT_MARGIN, maxTop),
  }
}

function getRect(element: Element): HighlightRect {
  const rect = element.getBoundingClientRect()
  const padding = 8
  const left = Math.max(8, rect.left - padding)
  const top = Math.max(8, rect.top - padding)
  const right = Math.min(window.innerWidth - 8, rect.right + padding)
  const bottom = Math.min(window.innerHeight - 8, rect.bottom + padding)
  return { top, right, bottom, left, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

export default function AssistantTour({ steps, index, onBack, onNext, onClose, onTargetClick }: {
  steps: AssistantTourStep[]
  index: number
  onBack: () => void
  onNext: () => void
  onClose: () => void
  onTargetClick: () => void
}) {
  const { t } = useTranslation()
  const step = steps[index]
  const [rect, setRect] = useState<HighlightRect | null>(null)
  const cardRef = useRef<HTMLElement | null>(null)
  const [cardSize, setCardSize] = useState<TooltipSize>({ width: 360, height: 280 })

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const updateCardSize = () => {
      const measured = card.getBoundingClientRect()
      if (measured.width > 0 && measured.height > 0) {
        setCardSize((current) => measured.width === current.width && measured.height === current.height
          ? current
          : { width: measured.width, height: measured.height })
      }
    }
    updateCardSize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateCardSize)
    observer?.observe(card)
    return () => observer?.disconnect()
  }, [index, rect])

  useLayoutEffect(() => {
    if (!step) return
    let targetElement: Element | null = null
    let listeningElement: Element | null = null
    let revealed = false
    let retryTimers: number[] = []
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    function handleTargetClick() {
      onTargetClick()
    }

    function findTarget(): Element | null {
      try {
        const direct = document.querySelector(step.selector)
        if (direct) return direct
      } catch { /* a stale selector must not break the guide */ }

      const expected = t(step.titleKey).trim().toLocaleLowerCase()
      if (!expected) return null
      const candidates = Array.from(document.querySelectorAll('a, button, summary, [data-assistant-tour]'))
      return candidates.find((candidate) => {
        const text = candidate.textContent?.replace(/\s+/g, ' ').trim().toLocaleLowerCase() ?? ''
        return text === expected || (expected.length > 5 && text.includes(expected))
      }) ?? null
    }

    function update() {
      targetElement = findTarget()
      if (!targetElement) {
        setRect(null)
        return
      }
      if (listeningElement !== targetElement) {
        listeningElement?.removeEventListener('click', handleTargetClick)
        listeningElement = targetElement
        listeningElement.addEventListener('click', handleTargetClick)
      }
      const disclosure = targetElement.closest('details')
      if (disclosure && !disclosure.open) disclosure.open = true
      if (!revealed) {
        revealed = true
        targetElement.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
      }
      const next = getRect(targetElement)
      if (next.width <= 2 || next.height <= 2) {
        setRect(null)
        return
      }
      setRect(next)
    }

    update()
    retryTimers = [80, 240, 600, 1200].map((delay) => window.setTimeout(update, reducedMotion ? 0 : delay))
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (targetElement) resizeObserver?.observe(targetElement)
    const mutationObserver = new MutationObserver(update)
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer))
      listeningElement?.removeEventListener('click', handleTargetClick)
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [onTargetClick, step, t])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') onNext()
      if (event.key === 'ArrowLeft' && index > 0) onBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, onBack, onClose, onNext])

  if (!step) return null
  const layout = getTooltipLayout(rect, cardSize, { width: window.innerWidth, height: window.innerHeight })
  const tooltipStyle = {
    left: `${layout.left}px`,
    top: `${layout.top}px`,
  }

  return createPortal(<div className="assistant-tour" role="dialog" aria-modal="true" aria-label={t('assistant.tour.label')} data-testid="assistant-tour">
    {rect ? <>
      <div className="assistant-tour__shade" onClick={onClose} style={{ inset: `0 0 ${window.innerHeight - rect.top}px 0` }} />
      <div className="assistant-tour__shade" onClick={onClose} style={{ inset: `${rect.bottom}px 0 0 0` }} />
      <div className="assistant-tour__shade" onClick={onClose} style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
      <div className="assistant-tour__shade" onClick={onClose} style={{ top: rect.top, left: rect.right, right: 0, height: rect.height }} />
      <div className="assistant-tour__ring" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} aria-hidden="true" />
    </> : <div className="assistant-tour__shade assistant-tour__shade--full" onClick={onClose} />}

    <section ref={cardRef} className={`assistant-tour__card assistant-tour__card--${layout.placement}${rect ? '' : ' assistant-tour__card--missing'}`} style={tooltipStyle}>
      <div className="assistant-tour__eyebrow">
        <span className="assistant-tour__paw" aria-hidden="true">●</span>
        {t('assistant.tour.step', { current: index + 1, total: steps.length })}
      </div>
      <h2>{t(step.titleKey)}</h2>
      <p>{t(step.bodyKey)}</p>
      <div className={`assistant-tour__instruction${rect ? '' : ' assistant-tour__instruction--searching'}`}><span aria-hidden="true">{rect ? '↗' : '…'}</span>{t(rect ? 'assistant.tour.clickHint' : 'assistant.tour.searching')}</div>
      <div className="assistant-tour__actions">
        <button type="button" className="assistant-tour__close" onClick={onClose}>{t('assistant.tour.close')}</button>
        <span />
        {index > 0 && <button type="button" className="assistant-tour__back" onClick={onBack}>{t('assistant.tour.back')}</button>}
        <button type="button" className="assistant-tour__next" onClick={onNext}>{t(index === steps.length - 1 ? 'assistant.tour.finish' : 'assistant.tour.next')}</button>
      </div>
    </section>
  </div>, document.body)
}
