import {
  Bank,
  BellRinging,
  Broadcast,
  ChartLineUp,
  GraduationCap,
  Heartbeat,
  IdentificationCard,
  Monitor,
  QrCode,
  Scan as ScanIcon,
  ShieldCheck,
  Ticket,
} from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { getMyTickets } from '../../api/public'
import { rememberTicketId } from '../../lib/ticketStorage'
import LandingRequestForm from './LandingRequestForm'

const HOW_IT_WORKS_STEPS = [
  { key: 'qr', Icon: QrCode },
  { key: 'scan', Icon: ScanIcon },
  { key: 'wait', Icon: Ticket },
  { key: 'call', Icon: BellRinging },
] as const

const SEGMENTS = [
  { key: 'clinics', Icon: Heartbeat },
  { key: 'gov', Icon: IdentificationCard },
  { key: 'banks', Icon: Bank },
  { key: 'universities', Icon: GraduationCap },
] as const

const BENEFITS = [
  { key: 'antiFraud', Icon: ShieldCheck },
  { key: 'realtime', Icon: Broadcast },
  { key: 'analytics', Icon: ChartLineUp },
] as const

/**
 * Restoration flow (ARCHITECTURE.md section 9, step 3 item 8): landing with
 * no token in the URL just means "check the device's cookie for an active
 * ticket first" before showing the marketing page.
 */
export default function LandingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function restore() {
      try {
        const tickets = await getMyTickets()
        if (!cancelled && tickets.length > 0) {
          rememberTicketId(tickets[0].id)
          navigate(`/t/${tickets[0].id}`, { replace: true })
          return
        }
      } catch {
        // no cookie yet, or a network hiccup — just show the landing page
      }
      if (!cancelled) setChecked(true)
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (!checked) {
    return (
      <div className="landing-page">
        <div className="spinner" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-hero__content">
          <h1 className="landing-hero__title">{t('landing.hero.title')}</h1>
          <p className="landing-hero__subtitle">{t('landing.hero.subtitle')}</p>
          <div className="landing-hero__actions">
            <a className="landing-hero__cta landing-hero__cta--primary" href="#cta-form">
              {t('landing.hero.ctaPrimary')}
            </a>
            <a className="landing-hero__cta landing-hero__cta--secondary" href="#how-it-works">
              {t('landing.hero.ctaSecondary')}
            </a>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="hero-visual__tile">
            <QrCode size={32} weight="bold" />
            <span className="hero-visual__label">{t('landing.hero.visual.qrLabel')}</span>
          </div>
          <div className="hero-visual__connector" />
          <div className="hero-visual__tile hero-visual__tile--accent">
            <Ticket size={32} weight="bold" />
            <span className="hero-visual__value">A-042</span>
            <span className="hero-visual__label">{t('landing.hero.visual.ticketLabel')}</span>
          </div>
          <div className="hero-visual__connector" />
          <div className="hero-visual__tile">
            <span className="hero-visual__pulse" />
            <Monitor size={32} weight="bold" />
            <span className="hero-visual__label">{t('landing.hero.visual.callLabel')}</span>
          </div>
        </div>
      </section>

      <section className="landing-section landing-how" id="how-it-works">
        <h2 className="landing-section__title">{t('landing.howItWorks.title')}</h2>
        <div className="landing-how__grid">
          {HOW_IT_WORKS_STEPS.map(({ key, Icon }) => (
            <div className="landing-how__step" key={key}>
              <div className="landing-how__icon">
                <Icon size={26} weight="bold" />
              </div>
              <h3 className="landing-how__step-title">
                {t(`landing.howItWorks.steps.${key}.title`)}
              </h3>
              <p className="landing-how__step-description">
                {t(`landing.howItWorks.steps.${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-segments">
        <h2 className="landing-section__title">{t('landing.segments.title')}</h2>
        <div className="landing-segments__grid">
          {SEGMENTS.map(({ key, Icon }, index) => (
            <div
              className={
                index % 2 === 1
                  ? 'landing-segment-card landing-segment-card--tint'
                  : 'landing-segment-card'
              }
              key={key}
            >
              <div className="landing-segment-card__icon">
                <Icon size={24} weight="bold" />
              </div>
              <h3 className="landing-segment-card__title">
                {t(`landing.segments.items.${key}.title`)}
              </h3>
              <p className="landing-segment-card__description">
                {t(`landing.segments.items.${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-benefits">
        <h2 className="landing-section__title">{t('landing.benefits.title')}</h2>
        <div className="landing-benefits__list">
          {BENEFITS.map(({ key, Icon }) => (
            <div className="landing-benefit-row" key={key}>
              <div className="landing-benefit-row__icon">
                <Icon size={24} weight="bold" />
              </div>
              <div className="landing-benefit-row__body">
                <h3 className="landing-benefit-row__title">
                  {t(`landing.benefits.items.${key}.title`)}
                </h3>
                <p className="landing-benefit-row__description">
                  {t(`landing.benefits.items.${key}.description`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta" id="cta-form">
        <div className="landing-cta__intro">
          <h2 className="landing-cta__title">{t('landing.cta.title')}</h2>
          <p className="landing-cta__subtitle">{t('landing.cta.subtitle')}</p>
        </div>
        <LandingRequestForm />
      </section>

      <footer className="landing-footer">
        <span>{t('landing.footer.rights', { year: new Date().getFullYear() })}</span>
        <Link className="landing-footer__login" to="/login">
          {t('landing.footer.staffLogin')}
        </Link>
      </footer>
    </div>
  )
}
