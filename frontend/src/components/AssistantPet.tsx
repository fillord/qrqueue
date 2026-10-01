import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { askAssistant, getAssistantStatus } from '../api/assistant'
import type { User } from '../api/types'
import { getAssistantAction, type AssistantAction } from '../lib/assistantActions'
import { getAssistantGuidance, getAssistantTour } from '../lib/assistantGuidance'
import AssistantTour from './AssistantTour'
import './assistant-pet.css'

const PENDING_TOUR_KEY = 'assistant:pending-tour'

function PetMark() {
  const furId = useId()
  const faceId = useId()
  return <svg className="assistant-pet__mark" viewBox="0 0 72 72" aria-hidden="true">
    <defs>
      <linearGradient id={furId} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#42a680" /><stop offset="1" stopColor="#0e5849" /></linearGradient>
      <radialGradient id={faceId} cx="38%" cy="28%" r="75%"><stop stopColor="#fff" /><stop offset="1" stopColor="#e1eee7" /></radialGradient>
    </defs>
    <ellipse className="assistant-pet__shadow" cx="36" cy="66" rx="22" ry="4" />
    <path className="assistant-pet__tail" d="M55 48c13-1 13 12 4 13-6 1-8-4-5-7" />
    <ellipse className="assistant-pet__torso" cx="36" cy="49" rx="20" ry="18" fill={`url(#${furId})`} />
    <ellipse className="assistant-pet__paw assistant-pet__paw--left" cx="23" cy="61" rx="8" ry="5" />
    <ellipse className="assistant-pet__paw assistant-pet__paw--right" cx="49" cy="61" rx="8" ry="5" />
    <path className="assistant-pet__ear assistant-pet__ear--left" d="M17 25 13 7l17 12Z" />
    <path className="assistant-pet__ear assistant-pet__ear--right" d="m55 25 4-18-17 12Z" />
    <ellipse className="assistant-pet__head" cx="36" cy="32" rx="25" ry="22" fill={`url(#${furId})`} />
    <ellipse className="assistant-pet__face" cx="36" cy="35" rx="17" ry="14" fill={`url(#${faceId})`} />
    <g className="assistant-pet__eyes"><ellipse cx="29" cy="33" rx="2.8" ry="3.6" /><ellipse cx="43" cy="33" rx="2.8" ry="3.6" /></g>
    <path className="assistant-pet__nose" d="m33 39 3-2 3 2-3 3Z" />
    <path className="assistant-pet__smile" d="M30 43c3 4 9 4 12 0" />
    <circle className="assistant-pet__cheek" cx="25" cy="41" r="2.4" /><circle className="assistant-pet__cheek" cx="47" cy="41" r="2.4" />
    <g className="assistant-pet__badge"><circle cx="52" cy="51" r="8" /><path d="M52 47v8M48 51h8" /></g>
  </svg>
}

type Message = { id: number; kind: 'user' | 'assistant'; text: string; action?: AssistantAction }

export default function AssistantPet({ user }: { user: User }) {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const guidance = getAssistantGuidance(pathname, user.role)
  const tour = getAssistantTour(pathname, user.role)
  const [open, setOpen] = useState(false)
  const [bubble, setBubble] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [tourIndex, setTourIndex] = useState<number | null>(null)
  const [tourOverride, setTourOverride] = useState<ReturnType<typeof getAssistantTour> | null>(null)
  const activeTour = tourOverride ?? tour
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)

  useEffect(() => {
    const key = `assistant-hint:${pathname}`
    let seen = false
    try { seen = sessionStorage.getItem(key) === '1' } catch { /* storage may be disabled */ }
    setBubble(!seen)
    let resumed = false
    try {
      const raw = sessionStorage.getItem(PENDING_TOUR_KEY)
      if (raw) {
        const pendingTour = JSON.parse(raw) as { path?: string; steps?: ReturnType<typeof getAssistantTour> }
        sessionStorage.removeItem(PENDING_TOUR_KEY)
        if (pendingTour.path === pathname && Array.isArray(pendingTour.steps) && pendingTour.steps.length > 0) {
          resumed = true
          setTourOverride(pendingTour.steps)
          window.setTimeout(() => setTourIndex(0), 120)
        }
      }
    } catch { /* ignore invalid session data */ }
    if (!resumed) {
      setTourIndex(null)
      setTourOverride(null)
    }
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const list = messagesRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, open, pending])

  useEffect(() => {
    if (!open) return
    let active = true
    getAssistantStatus()
      .then(({ available }) => { if (active) setConfigured(available) })
      .catch(() => { if (active) setConfigured(false) })
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => { active = false; window.clearTimeout(timer) }
  }, [open])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && tourIndex === null) setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [tourIndex])

  function dismissBubble() {
    setBubble(false)
    try { sessionStorage.setItem(`assistant-hint:${pathname}`, '1') } catch { /* no-op */ }
  }

  function openPanel() {
    dismissBubble()
    setOpen(true)
  }

  function startTour() {
    dismissBubble()
    setOpen(false)
    setTourOverride(null)
    setTourIndex(0)
  }

  function showAction(action: AssistantAction) {
    setOpen(false)
    try {
      if (action.destination) sessionStorage.setItem(PENDING_TOUR_KEY, JSON.stringify(action.destination))
      else sessionStorage.removeItem(PENDING_TOUR_KEY)
    } catch { /* storage may be disabled */ }
    if (action.destination) {
      setTourIndex(null)
      setTourOverride(null)
      navigate(action.destination.path)
      return
    }
    setTourOverride(action.steps)
    setTourIndex(0)
  }

  function closeTour() {
    try { sessionStorage.removeItem(PENDING_TOUR_KEY) } catch { /* storage may be disabled */ }
    setTourIndex(null)
    setTourOverride(null)
  }

  function nextTourStep() {
    setTourIndex((current) => {
      if (current === null || current >= activeTour.length - 1) {
        try { sessionStorage.removeItem(PENDING_TOUR_KEY) } catch { /* storage may be disabled */ }
        return null
      }
      return current + 1
    })
  }

  async function send(event?: FormEvent, suggested?: string) {
    event?.preventDefault()
    const text = (suggested ?? question).trim()
    if (!text || pending) return
    const userMessage: Message = { id: ++idRef.current, kind: 'user', text }
    setMessages((current) => [...current, userMessage])
    setQuestion('')
    const action = getAssistantAction(text, pathname, user.role, tour)

    if (!user.assistant_ai_enabled || configured === false) {
      setMessages((current) => [...current, {
        id: ++idRef.current,
        kind: 'assistant',
        text: `${t(guidance.hintKey)} ${t('assistant.localOnlyAnswer')}`,
        action,
      }])
      return
    }

    setPending(true)
    const locale = (['ru', 'kk', 'en'].includes(i18n.language.slice(0, 2)) ? i18n.language.slice(0, 2) : 'ru') as 'ru' | 'kk' | 'en'
    try {
      const result = await askAssistant(text, pathname, locale)
      setMessages((current) => [...current, { id: ++idRef.current, kind: 'assistant', text: result.answer, action }])
    } catch {
      setConfigured(false)
      setMessages((current) => [...current, {
        id: ++idRef.current,
        kind: 'assistant',
        text: `${t(guidance.hintKey)} ${t('assistant.unavailableAnswer')}`,
        action,
      }])
    } finally {
      setPending(false)
    }
  }

  return <>
    {tourIndex !== null && <AssistantTour
      steps={activeTour}
      index={tourIndex}
      onBack={() => setTourIndex((current) => current === null ? null : Math.max(0, current - 1))}
      onNext={nextTourStep}
      onClose={closeTour}
    />}
    <aside className={`assistant-pet${tourIndex !== null ? ' assistant-pet--touring' : ''}`} aria-label={t('assistant.name')}>
    {!open && bubble && <div className="assistant-pet__bubble" role="status">
      <button className="assistant-pet__bubble-close" type="button" onClick={dismissBubble} aria-label={t('assistant.dismiss')}>×</button>
      <strong>{t(guidance.titleKey)}</strong>
      <span>{t(guidance.hintKey)}</span>
      <button className="assistant-pet__bubble-tour" type="button" onClick={startTour}>{t('assistant.tour.start')}</button>
    </div>}

    {open && <section className="assistant-pet__panel" role="dialog" aria-label={t('assistant.name')}>
      <header className="assistant-pet__panel-head">
        <span className="assistant-pet__mini"><PetMark /></span>
        <span><strong>{t('assistant.name')}</strong><small>{t('assistant.subtitle')}</small></span>
        <button type="button" onClick={() => setOpen(false)} aria-label={t('assistant.close')}>×</button>
      </header>
      <div className="assistant-pet__content">
        <div className="assistant-pet__page-hint">
          <small>{t('assistant.onThisPage')}</small>
          <strong>{t(guidance.titleKey)}</strong>
          <p>{t(guidance.hintKey)}</p>
        </div>
        <button className="assistant-pet__tour-start" type="button" onClick={startTour}>
          <span aria-hidden="true">↗</span>
          <span><strong>{t('assistant.tour.start')}</strong><small>{t('assistant.tour.startHint')}</small></span>
        </button>
        <button className="assistant-pet__suggestion" type="button" onClick={() => void send(undefined, t(guidance.promptKey))}>
          {t(guidance.promptKey)}
        </button>
        {messages.length > 0 && <div ref={messagesRef} className="assistant-pet__messages" aria-live="polite">
          {messages.map((message) => <div key={message.id} className={`assistant-pet__message assistant-pet__message--${message.kind}`}>
            <p>{message.text}</p>
            {message.action && <button type="button" className="assistant-pet__message-action" onClick={() => showAction(message.action!)}>{t(message.action.labelKey)}</button>}
          </div>)}
          {pending && <p className="assistant-pet__message assistant-pet__message--assistant">{t('assistant.thinking')}</p>}
        </div>}
        {user.assistant_ai_enabled && configured !== false ? <form className="assistant-pet__form" onSubmit={(event) => void send(event)}>
          <input ref={inputRef} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={600} placeholder={t('assistant.placeholder')} aria-label={t('assistant.placeholder')} />
          <button type="submit" disabled={pending || question.trim().length < 2}>{t('assistant.send')}</button>
        </form> : <div className="assistant-pet__offline">
          <span>{user.assistant_ai_enabled ? t('assistant.freeAiUnavailable') : t('assistant.aiDisabled')}</span>
          <Link to="/profile">{t('assistant.openSettings')}</Link>
        </div>}
        <p className="assistant-pet__privacy">{t('assistant.privacy')}</p>
      </div>
    </section>}

    <button className={`assistant-pet__button${open ? ' assistant-pet__button--open' : ''}`} type="button" onClick={() => open ? setOpen(false) : openPanel()} aria-label={open ? t('assistant.close') : t('assistant.open')} aria-expanded={open}>
      <PetMark />
      <span>{open ? t('assistant.close') : t('assistant.ask')}</span>
    </button>
  </aside>
  </>
}
