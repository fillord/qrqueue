import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { ArrowUp, CaretDown, ClockCounterClockwise, MapTrifold, PencilSimple } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'

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
      <linearGradient id={furId} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#75d7b1" /><stop offset="1" stopColor="#218369" /></linearGradient>
      <linearGradient id={faceId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#f7fffc" /><stop offset="1" stopColor="#d8efe6" /></linearGradient>
    </defs>
    <ellipse className="assistant-pet__shadow" cx="36" cy="67" rx="21" ry="3.5" />
    <path className="assistant-pet__antenna" d="M36 13V7" />
    <circle className="assistant-pet__antenna-light" cx="36" cy="5" r="3" />
    <path className="assistant-pet__arm assistant-pet__arm--left" d="M19 45c-8 1-8 11-3 14" />
    <path className="assistant-pet__arm assistant-pet__arm--right" d="M53 45c8 1 8 11 3 14" />
    <rect className="assistant-pet__body" x="18" y="38" width="36" height="25" rx="12" fill={`url(#${furId})`} />
    <rect className="assistant-pet__foot" x="21" y="58" width="12" height="8" rx="4" />
    <rect className="assistant-pet__foot" x="39" y="58" width="12" height="8" rx="4" />
    <rect className="assistant-pet__head" x="10" y="12" width="52" height="38" rx="17" fill={`url(#${furId})`} />
    <rect className="assistant-pet__face" x="17" y="19" width="38" height="23" rx="10" fill={`url(#${faceId})`} />
    <g className="assistant-pet__eyes"><circle cx="28" cy="30" r="3.2" /><circle cx="44" cy="30" r="3.2" /></g>
    <path className="assistant-pet__smile" d="M30 36c3.5 3 8.5 3 12 0" />
    <circle className="assistant-pet__chest-light" cx="36" cy="50" r="4" />
    <path className="assistant-pet__chest-mark" d="M36 47.5v5M33.5 50h5" />
  </svg>
}

type Message = { id: number; kind: 'user' | 'assistant'; text: string; action?: AssistantAction }

function cleanAssistantText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
}

export default function AssistantPet({ user }: { user: User }) {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const guidance = getAssistantGuidance(pathname, user.role)
  const tour = getAssistantTour(pathname, user.role)
  const [open, setOpen] = useState(false)
  const [bubble, setBubble] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [composerOpen, setComposerOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tourIndex, setTourIndex] = useState<number | null>(null)
  const [tourOverride, setTourOverride] = useState<ReturnType<typeof getAssistantTour> | null>(null)
  const activeTour = tourOverride ?? tour
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)
  const latestAssistant = [...messages].reverse().find((message) => message.kind === 'assistant')
  const latestUser = [...messages].reverse().find((message) => message.kind === 'user')

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
  }, [historyOpen, messages, open, pending])

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
    setComposerOpen(messages.length === 0)
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
    setTourOverride(action.steps)
    try {
      if (action.destination) sessionStorage.setItem(PENDING_TOUR_KEY, JSON.stringify(action.destination))
      else sessionStorage.removeItem(PENDING_TOUR_KEY)
    } catch { /* storage may be disabled */ }
    setTourIndex(0)
  }

  function closeTour() {
    try { sessionStorage.removeItem(PENDING_TOUR_KEY) } catch { /* storage may be disabled */ }
    setTourIndex(null)
    setTourOverride(null)
  }

  function dismissCurrentTourStep() {
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
    setComposerOpen(false)
    setHistoryOpen(false)
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
      setMessages((current) => [...current, { id: ++idRef.current, kind: 'assistant', text: cleanAssistantText(result.answer), action }])
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
      onTargetClick={dismissCurrentTourStep}
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
        <span className="assistant-pet__presence" aria-hidden="true" />
        <span><strong>{t('assistant.name')}</strong><small>{t('assistant.subtitle')}</small></span>
        <button type="button" onClick={() => setOpen(false)} aria-label={t('assistant.close')}><CaretDown size={20} weight="bold" /></button>
      </header>
      <div className="assistant-pet__content">
        <section className="assistant-pet__response" aria-live="polite">
          {latestAssistant ? <>
            {latestUser && <small><span>{t('assistant.yourQuestion')}</span>{latestUser.text}</small>}
            <p>{latestAssistant.text}</p>
            {latestAssistant.action && <button type="button" className="assistant-pet__message-action" onClick={() => showAction(latestAssistant.action!)}>{t(latestAssistant.action.labelKey)}</button>}
          </> : <>
            <small><span>{t('assistant.onThisPage')}</span>{t(guidance.titleKey)}</small>
            <p>{t(guidance.hintKey)}</p>
            <button className="assistant-pet__suggestion" type="button" onClick={() => void send(undefined, t(guidance.promptKey))}>{t(guidance.promptKey)}</button>
          </>}
          {pending && <p className="assistant-pet__thinking">{t('assistant.thinking')}</p>}
        </section>

        {composerOpen && user.assistant_ai_enabled && configured !== false && <form className="assistant-pet__form" onSubmit={(event) => void send(event)}>
          <input ref={inputRef} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={600} placeholder={t('assistant.placeholder')} aria-label={t('assistant.placeholder')} />
          <button type="submit" disabled={pending || question.trim().length < 2} aria-label={t('assistant.send')}><ArrowUp size={20} weight="bold" /></button>
        </form>}

        <div className="assistant-pet__stage" aria-hidden="true"><PetMark /></div>

        {historyOpen && messages.length > 0 && <div ref={messagesRef} className="assistant-pet__messages" aria-label={t('assistant.history')}>
          {messages.map((message) => <div key={message.id} className={`assistant-pet__message assistant-pet__message--${message.kind}`}>
            <small>{t(message.kind === 'user' ? 'assistant.you' : 'assistant.name')}</small>
            <p>{message.text}</p>
          </div>)}
        </div>}

        {(!user.assistant_ai_enabled || configured === false) && <div className="assistant-pet__offline">
          <span>{user.assistant_ai_enabled ? t('assistant.freeAiUnavailable') : t('assistant.aiDisabled')}</span>
          <Link to="/profile">{t('assistant.openSettings')}</Link>
        </div>}

        <nav className="assistant-pet__dock" aria-label={t('assistant.controls')}>
          <button type="button" onClick={() => { setComposerOpen(true); window.setTimeout(() => inputRef.current?.focus(), 50) }} aria-label={t('assistant.newQuestion')} title={t('assistant.newQuestion')}><PencilSimple size={23} /></button>
          <button type="button" className={historyOpen ? 'is-active' : ''} onClick={() => setHistoryOpen((value) => !value)} aria-label={t(historyOpen ? 'assistant.hideHistory' : 'assistant.history')} title={t(historyOpen ? 'assistant.hideHistory' : 'assistant.history')}><ClockCounterClockwise size={23} /></button>
          <button type="button" onClick={startTour} aria-label={t('assistant.tour.start')} title={t('assistant.tour.start')}><MapTrifold size={23} /></button>
          <button type="button" onClick={() => setOpen(false)} aria-label={t('assistant.close')} title={t('assistant.close')}><CaretDown size={23} /></button>
        </nav>
      </div>
    </section>}

    <button className={`assistant-pet__button${open ? ' assistant-pet__button--open' : ''}`} type="button" onClick={() => open ? setOpen(false) : openPanel()} aria-label={open ? t('assistant.close') : t('assistant.open')} aria-expanded={open}>
      <PetMark />
      <span>{open ? t('assistant.close') : t('assistant.ask')}</span>
    </button>
  </aside>
  </>
}
