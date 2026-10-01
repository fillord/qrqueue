import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { AssistantTourStep } from '../lib/assistantGuidance'

type HighlightRect = { top: number; right: number; bottom: number; left: number; width: number; height: number }

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
  const [placement, setPlacement] = useState<'above' | 'below'>('below')

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
      setPlacement(next.bottom + 250 < window.innerHeight ? 'below' : 'above')
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
  const tooltipStyle = rect && window.innerWidth > 620 ? {
    left: `${Math.min(Math.max(12, rect.left), window.innerWidth - 372)}px`,
    top: placement === 'below' ? `${rect.bottom + 14}px` : undefined,
    bottom: placement === 'above' ? `${window.innerHeight - rect.top + 14}px` : undefined,
  } : !rect ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' } : undefined

  return createPortal(<div className="assistant-tour" role="dialog" aria-modal="true" aria-label={t('assistant.tour.label')} data-testid="assistant-tour">
    {rect ? <>
      <div className="assistant-tour__shade" onClick={onClose} style={{ inset: `0 0 ${window.innerHeight - rect.top}px 0` }} />
      <div className="assistant-tour__shade" onClick={onClose} style={{ inset: `${rect.bottom}px 0 0 0` }} />
      <div className="assistant-tour__shade" onClick={onClose} style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
      <div className="assistant-tour__shade" onClick={onClose} style={{ top: rect.top, left: rect.right, right: 0, height: rect.height }} />
      <div className="assistant-tour__ring" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} aria-hidden="true" />
    </> : <div className="assistant-tour__shade assistant-tour__shade--full" onClick={onClose} />}

    <section className={`assistant-tour__card assistant-tour__card--${placement}${rect ? '' : ' assistant-tour__card--missing'}`} style={tooltipStyle}>
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
