import { FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'

import { askAssistant, getAssistantStatus } from '../api/assistant'
import type { User } from '../api/types'
import { getAssistantGuidance } from '../lib/assistantGuidance'
import './assistant-pet.css'

function PetMark() {
  return <svg className="assistant-pet__mark" viewBox="0 0 72 72" aria-hidden="true">
    <path className="assistant-pet__ear" d="M15 25 12 9l16 10M57 25 60 9 44 19" />
    <path className="assistant-pet__body" d="M36 14c17 0 27 10 27 28 0 15-10 24-27 24S9 57 9 42c0-18 10-28 27-28Z" />
    <path className="assistant-pet__face" d="M18 36c0-11 8-17 18-17s18 6 18 17c0 12-8 19-18 19s-18-7-18-19Z" />
    <circle cx="29" cy="36" r="3.3" />
    <circle cx="43" cy="36" r="3.3" />
    <path className="assistant-pet__smile" d="M31 45c3 2 7 2 10 0" />
    <path className="assistant-pet__badge" d="M52 49h12v12H52zM58 51v8M54 55h8" />
  </svg>
}

type Message = { id: number; kind: 'user' | 'assistant'; text: string }

export default function AssistantPet({ user }: { user: User }) {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const guidance = getAssistantGuidance(pathname, user.role)
  const [open, setOpen] = useState(false)
  const [bubble, setBubble] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const idRef = useRef(0)

  useEffect(() => {
    const key = `assistant-hint:${pathname}`
    let seen = false
    try { seen = sessionStorage.getItem(key) === '1' } catch { /* storage may be disabled */ }
    setBubble(!seen)
  }, [pathname])

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
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  function dismissBubble() {
    setBubble(false)
    try { sessionStorage.setItem(`assistant-hint:${pathname}`, '1') } catch { /* no-op */ }
  }

  function openPanel() {
    dismissBubble()
    setOpen(true)
  }

  async function send(event?: FormEvent, suggested?: string) {
    event?.preventDefault()
    const text = (suggested ?? question).trim()
    if (!text || pending) return
    const userMessage: Message = { id: ++idRef.current, kind: 'user', text }
    setMessages((current) => [...current, userMessage])
    setQuestion('')

    if (!user.assistant_ai_enabled || configured === false) {
      setMessages((current) => [...current, {
        id: ++idRef.current,
        kind: 'assistant',
        text: `${t(guidance.hintKey)} ${t('assistant.localOnlyAnswer')}`,
      }])
      return
    }

    setPending(true)
    const locale = (['ru', 'kk', 'en'].includes(i18n.language.slice(0, 2)) ? i18n.language.slice(0, 2) : 'ru') as 'ru' | 'kk' | 'en'
    try {
      const result = await askAssistant(text, pathname, locale)
      setMessages((current) => [...current, { id: ++idRef.current, kind: 'assistant', text: result.answer }])
    } catch {
      setConfigured(false)
      setMessages((current) => [...current, {
        id: ++idRef.current,
        kind: 'assistant',
        text: `${t(guidance.hintKey)} ${t('assistant.unavailableAnswer')}`,
      }])
    } finally {
      setPending(false)
    }
  }

  return <aside className="assistant-pet" aria-label={t('assistant.name')}>
    {!open && bubble && <div className="assistant-pet__bubble" role="status">
      <button className="assistant-pet__bubble-close" type="button" onClick={dismissBubble} aria-label={t('assistant.dismiss')}>×</button>
      <strong>{t(guidance.titleKey)}</strong>
      <span>{t(guidance.hintKey)}</span>
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
        <button className="assistant-pet__suggestion" type="button" onClick={() => void send(undefined, t(guidance.promptKey))}>
          {t(guidance.promptKey)}
        </button>
        {messages.length > 0 && <div className="assistant-pet__messages" aria-live="polite">
          {messages.map((message) => <p key={message.id} className={`assistant-pet__message assistant-pet__message--${message.kind}`}>{message.text}</p>)}
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
}
