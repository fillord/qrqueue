import type { UserRole } from '../api/types'
import type { AssistantTourStep } from './assistantGuidance'

export interface AssistantAction {
  labelKey: string
  steps: AssistantTourStep[]
  destination?: { path: string; steps: AssistantTourStep[] }
}

const step = (selector: string, titleKey: string, bodyKey: string): AssistantTourStep => ({ selector, titleKey, bodyKey })
const has = (text: string, ...words: string[]) => words.some((word) => text.includes(word))

function sectionAction(path: string, currentPath: string, navSelector: string, titleKey: string, bodyKey: string, destinationSelector: string): AssistantAction {
  const destinationSteps = [step(destinationSelector, titleKey, bodyKey)]
  return {
    labelKey: currentPath === path ? 'assistant.action.show' : 'assistant.action.goAndShow',
    steps: currentPath === path ? destinationSteps : [step(navSelector, titleKey, 'assistant.tour.actions.openSection')],
    destination: currentPath === path ? undefined : { path, steps: destinationSteps },
  }
}

export function getAssistantAction(message: string, path: string, role: UserRole, fallback: AssistantTourStep[]): AssistantAction {
  const text = message.toLocaleLowerCase().replace(/ё/g, 'е')

  if (has(text, 'парол', 'password', 'құпиясөз')) {
    const destinationSteps = [step('.profile-card[data-profile-section="security"]', 'profile.security', 'assistant.tour.actions.profileSecurity')]
    return path === '/profile'
      ? { labelKey: 'assistant.action.show', steps: destinationSteps }
      : { labelKey: 'assistant.action.goAndShow', steps: [step('.app-header__profile', 'assistant.pages.profile.title', 'assistant.tour.actions.openProfileSettings')], destination: { path: '/profile', steps: destinationSteps } }
  }
  if (has(text, 'фото', 'аватар', 'профил', 'profile', 'аты-жөн', 'сурет') || (/\bимя\b/u.test(text) && !has(text, 'организац', 'ұйым', 'organization'))) {
    const selector = path === '/profile' ? '.profile-card[data-profile-section="personal"]' : '.app-header__profile'
    const body = path === '/profile' ? 'assistant.tour.actions.profilePersonal' : 'assistant.tour.actions.openProfileSettings'
    const destinationSteps = [step('.profile-card[data-profile-section="personal"]', 'assistant.pages.profile.title', 'assistant.tour.actions.profilePersonal')]
    return path === '/profile'
      ? { labelKey: 'assistant.action.show', steps: destinationSteps }
      : { labelKey: 'assistant.action.goAndShow', steps: [step(selector, 'assistant.pages.profile.title', body)], destination: { path: '/profile', steps: destinationSteps } }
  }
  if (has(text, 'помощник', 'бот', 'assistant', 'navigator', 'көмекші', 'жасанды интеллект') || /\bии\b/u.test(text)) {
    const selector = path === '/profile' ? '.profile-card--assistant' : '.app-header__profile'
    const body = path === '/profile' ? 'assistant.tour.actions.profileSettings' : 'assistant.tour.actions.openProfileSettings'
    const destinationSteps = [step('.profile-card--assistant', 'assistant.pages.profile.title', 'assistant.tour.actions.profileSettings')]
    return path === '/profile'
      ? { labelKey: 'assistant.action.show', steps: destinationSteps }
      : { labelKey: 'assistant.action.goAndShow', steps: [step(selector, 'assistant.pages.profile.title', body)], destination: { path: '/profile', steps: destinationSteps } }
  }

  if (role === 'org_admin') {
    if ((has(text, 'организац', 'ұйым', 'organization') && has(text, 'настрой', 'назван', 'логотип', 'цвет', 'язык', 'часов', 'setting', 'name', 'logo', 'баптау')) || has(text, 'бренд')) {
      return sectionAction('/admin/organization', path, '[href="/admin/organization"]', 'assistant.pages.organizationSettings.title', 'assistant.tour.actions.organizationSettings', '.admin-organization__form')
    }
    if (has(text, 'чек-ин', 'чекин', 'приход', 'уход', 'рабочего времени', 'attendance', 'келу', 'кету')) {
      return sectionAction('/admin/attendance', path, '[href="/admin/attendance"]', 'assistant.pages.attendance.title', 'assistant.tour.actions.attendanceEmployees', '.attendance-admin__create, .attendance-admin')
    }
    if (has(text, 'кабинет', 'cabinet')) return sectionAction('/admin/cabinets', path, '[href="/admin/cabinets"]', 'assistant.pages.cabinets.title', 'assistant.tour.actions.createCabinet', '[data-assistant-tour="create-cabinet"]')
    if (has(text, 'очеред', 'талон', 'queue', 'кезек')) return sectionAction('/admin/queues', path, '[href="/admin/queues"]', 'assistant.pages.queues.title', 'assistant.tour.actions.createQueue', '[data-assistant-tour="create-queue"]')
    if (has(text, 'телевиз', 'тв', 'экран', 'screen')) return sectionAction('/admin/tv-screens', path, '[href="/admin/tv-screens"]', 'assistant.pages.tv.title', 'assistant.tour.actions.createScreen', '[data-assistant-tour="create-screen"]')
    if (has(text, 'распис', 'отделен', 'видео', 'youtube', 'ютуб', 'плейлист', 'schedule', 'media')) return sectionAction('/admin/signage', path, '[href="/admin/signage"]', 'assistant.pages.signage.title', 'assistant.tour.actions.departments', '[data-assistant-tour="departments"]')
    if (has(text, 'сотруд', 'пользоват', 'роль', 'employee', 'user', 'қызметкер')) return sectionAction('/admin/users', path, '[href="/admin/users"]', 'assistant.pages.users.title', 'assistant.tour.actions.createUser', '[data-assistant-tour="create-user"]')
    if (has(text, 'проблем', 'ошиб', 'не работает', 'problem', 'error')) return sectionAction('/admin/problems', path, '[href="/admin/problems"]', 'assistant.pages.problems.title', 'assistant.tour.actions.problemFilters', '.admin-problems__filters, .admin-problems')
  }

  if (role === 'superadmin') {
    if (has(text, 'организац', 'ұйым', 'organization')) return sectionAction('/sa/organizations', path, '[href="/sa/organizations"]', 'assistant.pages.organizations.title', 'assistant.tour.actions.createOrganization', '[data-assistant-tour="create-organization"], .directory__toolbar')
    if (has(text, 'пользоват', 'сотруд', 'user', 'қызметкер')) return sectionAction('/sa/users', path, '[href="/sa/users"]', 'assistant.pages.allUsers.title', 'assistant.tour.actions.searchUsers', '.directory__toolbar')
  }

  if (role === 'operator' && has(text, 'кабинет', 'cabinet')) return { labelKey: 'assistant.action.show', steps: [step('.operator-select__grid, .operator-select', 'assistant.pages.operator.title', 'assistant.tour.actions.chooseCabinet')] }
  if (role === 'registrar' || has(text, 'выдать талон', 'issue ticket')) return { labelKey: 'assistant.action.show', steps: [step('.registrar-page__list, .registrar-page', 'assistant.pages.registrar.title', 'assistant.tour.actions.issueTicket')] }

  return { labelKey: 'assistant.action.showCurrent', steps: fallback.slice(0, 1) }
}
