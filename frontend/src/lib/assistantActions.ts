import type { UserRole } from '../api/types'
import type { AssistantTourStep } from './assistantGuidance'

export interface AssistantAction {
  labelKey: string
  steps: AssistantTourStep[]
  destination?: { path: string; steps: AssistantTourStep[] }
}

const step = (selector: string, titleKey: string, bodyKey: string): AssistantTourStep => ({ selector, titleKey, bodyKey })
const has = (text: string, ...words: string[]) => words.some((word) => text.includes(word))
const wantsCreate = (text: string) => has(text, 'созд', 'добав', 'новый', 'новую', 'create', 'add', 'қосу', 'жасау')
const wantsDelete = (text: string) => has(text, 'удал', 'архив', 'delete', 'archive', 'жою', 'мұрағат')
const wantsUnpair = (text: string) => has(text, 'отвяз', 'отключ', 'unpair', 'disconnect', 'ажырат')
const wantsManage = (text: string) => has(text, 'редакт', 'измен', 'переимен', 'настро', 'удал', 'архив', 'отвяз', 'edit', 'change', 'rename', 'setting', 'delete', 'archive', 'unpair', 'өзгерт', 'бапта', 'жою')
const wantsSearch = (text: string) => has(text, 'поиск', 'найти', 'фильтр', 'сортир', 'search', 'find', 'filter', 'іздеу', 'сүзг')

function sectionAction(path: string, currentPath: string, navSelector: string, titleKey: string, bodyKey: string, destinationSelector: string): AssistantAction {
  const destinationSteps = [step(destinationSelector, titleKey, bodyKey)]
  return {
    labelKey: 'assistant.action.show',
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
      : { labelKey: 'assistant.action.show', steps: [step('.app-header__profile', 'assistant.pages.profile.title', 'assistant.tour.actions.openProfileSettings')], destination: { path: '/profile', steps: destinationSteps } }
  }
  if (has(text, 'фото', 'аватар', 'профил', 'profile', 'аты-жөн', 'сурет') || (/\bимя\b/u.test(text) && !has(text, 'организац', 'ұйым', 'organization'))) {
    const selector = path === '/profile' ? '.profile-card[data-profile-section="personal"]' : '.app-header__profile'
    const body = path === '/profile' ? 'assistant.tour.actions.profilePersonal' : 'assistant.tour.actions.openProfileSettings'
    const destinationSteps = [step('.profile-card[data-profile-section="personal"]', 'assistant.pages.profile.title', 'assistant.tour.actions.profilePersonal')]
    return path === '/profile'
      ? { labelKey: 'assistant.action.show', steps: destinationSteps }
      : { labelKey: 'assistant.action.show', steps: [step(selector, 'assistant.pages.profile.title', body)], destination: { path: '/profile', steps: destinationSteps } }
  }
  if (has(text, 'помощник', 'бот', 'assistant', 'navigator', 'көмекші', 'жасанды интеллект') || /\bии\b/u.test(text)) {
    const selector = path === '/profile' ? '.profile-card--assistant' : '.app-header__profile'
    const body = path === '/profile' ? 'assistant.tour.actions.profileSettings' : 'assistant.tour.actions.openProfileSettings'
    const destinationSteps = [step('.profile-card--assistant', 'assistant.pages.profile.title', 'assistant.tour.actions.profileSettings')]
    return path === '/profile'
      ? { labelKey: 'assistant.action.show', steps: destinationSteps }
      : { labelKey: 'assistant.action.show', steps: [step(selector, 'assistant.pages.profile.title', body)], destination: { path: '/profile', steps: destinationSteps } }
  }

  if (role === 'org_admin') {
    if ((has(text, 'организац', 'ұйым', 'organization') && has(text, 'настрой', 'назван', 'логотип', 'цвет', 'язык', 'часов', 'setting', 'name', 'logo', 'баптау')) || has(text, 'бренд')) {
      return sectionAction('/admin/organization', path, '[href="/admin/organization"]', 'assistant.pages.organizationSettings.title', 'assistant.tour.actions.organizationSettings', '.admin-organization__form')
    }
    if (has(text, 'чек-ин', 'чекин', 'приход', 'уход', 'рабочего времени', 'attendance', 'келу', 'кету')) {
      if (has(text, 'стойк', 'киоск', 'гео', 'qr', 'регистрац', 'kiosk', 'geofence')) return sectionAction('/admin/attendance/settings', path, '[href="/admin/attendance/settings"]', 'assistant.pages.attendance.title', 'assistant.tour.actions.attendanceSettings', '#attendance-settings, .attendance-admin__settings')
      if (has(text, 'исправ', 'отмет', 'событ', 'correct', 'event')) return sectionAction('/admin/attendance/events', path, '[href="/admin/attendance/events"]', 'assistant.pages.attendance.title', 'assistant.tour.actions.attendanceEvents', '#attendance-events')
      if (has(text, 'сотруд', 'лиц', 'импорт', 'employee', 'face', 'import')) return sectionAction('/admin/attendance/employees', path, '[href="/admin/attendance/employees"]', 'assistant.pages.attendance.title', 'assistant.tour.actions.attendanceEmployees', '.attendance-admin__create, #attendance-employees')
      return sectionAction('/admin/attendance', path, '[href="/admin/attendance"]', 'assistant.pages.attendance.title', 'assistant.tour.actions.attendanceSummary', '#attendance-summary')
    }
    if (has(text, 'видео', 'youtube', 'ютуб', 'плейлист', 'реклам', 'ролик', 'media')) return sectionAction('/admin/signage', path, '[href="/admin/signage"]', 'assistant.pages.signage.title', 'assistant.tour.actions.media', '[data-assistant-tour="media"]')
    if (has(text, 'импорт', 'excel', 'эксел', 'шаблон')) return sectionAction('/admin/signage', path, '[href="/admin/signage"]', 'assistant.pages.signage.title', 'assistant.tour.actions.scheduleImport', '[data-assistant-tour="schedule-import"]')
    if (has(text, 'распис', 'отделен', 'schedule', 'department')) return sectionAction('/admin/signage', path, '[href="/admin/signage"]', 'assistant.pages.signage.title', 'assistant.tour.actions.departments', '[data-assistant-tour="departments"]')
    if (has(text, 'кабинет', 'cabinet')) {
      return wantsCreate(text)
        ? sectionAction('/admin/cabinets', path, '[href="/admin/cabinets"]', 'assistant.pages.cabinets.title', 'assistant.tour.actions.createCabinet', '[data-assistant-tour="create-cabinet"]')
        : sectionAction('/admin/cabinets', path, '[href="/admin/cabinets"]', 'assistant.pages.cabinets.title', 'assistant.tour.actions.manageRows', '[data-assistant-tour="cabinet-list"] .admin-table__actions button:first-child, [data-assistant-tour="cabinet-list"]')
    }
    if (has(text, 'очеред', 'талон', 'queue', 'кезек')) {
      return wantsCreate(text)
        ? sectionAction('/admin/queues', path, '[href="/admin/queues"]', 'assistant.pages.queues.title', 'assistant.tour.actions.createQueue', '[data-assistant-tour="create-queue"]')
        : sectionAction('/admin/queues', path, '[href="/admin/queues"]', 'assistant.pages.queues.title', 'assistant.tour.actions.manageRows', '[data-assistant-tour="queue-list"] .admin-table__actions button:first-child, [data-assistant-tour="queue-list"]')
    }
    if (has(text, 'телевиз', 'тв', 'экран', 'screen')) {
      if (wantsCreate(text) || has(text, 'подключ')) return sectionAction('/admin/tv-screens', path, '[href="/admin/tv-screens"]', 'assistant.pages.tv.title', 'assistant.tour.actions.createScreen', '[data-assistant-tour="create-screen"]')
      if (wantsDelete(text)) return sectionAction('/admin/tv-screens', path, '[href="/admin/tv-screens"]', 'assistant.pages.tv.title', 'assistant.tour.actions.screenDelete', '[data-assistant-tour="screen-delete"], [data-assistant-tour="screen-list"]')
      if (wantsUnpair(text)) return sectionAction('/admin/tv-screens', path, '[href="/admin/tv-screens"]', 'assistant.pages.tv.title', 'assistant.tour.actions.screenUnpair', '[data-assistant-tour="screen-unpair"], [data-assistant-tour="screen-list"]')
      return sectionAction('/admin/tv-screens', path, '[href="/admin/tv-screens"]', 'assistant.pages.tv.title', 'assistant.tour.actions.screenEdit', '[data-assistant-tour="screen-settings"], [data-assistant-tour="screen-list"]')
    }
    if (has(text, 'сотруд', 'пользоват', 'роль', 'employee', 'user', 'қызметкер')) {
      if (wantsCreate(text)) return sectionAction('/admin/users', path, '[href="/admin/users"]', 'assistant.pages.users.title', 'assistant.tour.actions.createUser', '[data-assistant-tour="create-user"]')
      return sectionAction('/admin/users', path, '[href="/admin/users"]', 'assistant.pages.users.title', wantsSearch(text) ? 'assistant.tour.actions.searchUsers' : 'assistant.tour.actions.manageRows', '.directory__toolbar, .admin-table__actions button:first-child')
    }
    if (has(text, 'проблем', 'ошиб', 'не работает', 'problem', 'error')) return sectionAction('/admin/problems', path, '[href="/admin/problems"]', 'assistant.pages.problems.title', 'assistant.tour.actions.problemFilters', '.admin-problems__filters, .admin-problems')
  }

  if (role === 'superadmin') {
    if (has(text, 'организац', 'ұйым', 'organization')) return wantsCreate(text)
      ? sectionAction('/sa/organizations', path, '[href="/sa/organizations"]', 'assistant.pages.organizations.title', 'assistant.tour.actions.createOrganization', '[data-assistant-tour="create-organization"]')
      : sectionAction('/sa/organizations', path, '[href="/sa/organizations"]', 'assistant.pages.organizations.title', 'assistant.tour.actions.searchOrganizations', '.directory__toolbar, .admin-table')
    if (has(text, 'пользоват', 'сотруд', 'user', 'қызметкер')) return wantsCreate(text)
      ? sectionAction('/sa/users', path, '[href="/sa/users"]', 'assistant.pages.allUsers.title', 'assistant.tour.actions.createUser', '[data-assistant-tour="create-user"]')
      : sectionAction('/sa/users', path, '[href="/sa/users"]', 'assistant.pages.allUsers.title', wantsSearch(text) ? 'assistant.tour.actions.searchUsers' : 'assistant.tour.actions.manageRows', '.directory__toolbar, .admin-table__actions button:first-child')
  }

  if (role === 'operator' && has(text, 'кабинет', 'cabinet')) return { labelKey: 'assistant.action.show', steps: [step('.operator-select__grid, .operator-select', 'assistant.pages.operator.title', 'assistant.tour.actions.chooseCabinet')] }
  if (role === 'registrar' || has(text, 'выдать талон', 'issue ticket')) return { labelKey: 'assistant.action.show', steps: [step('.registrar-page__list, .registrar-page', 'assistant.pages.registrar.title', 'assistant.tour.actions.issueTicket')] }

  if (role === 'org_admin' && path === '/admin/tv-screens') {
    if (wantsCreate(text)) return sectionAction(path, path, '', 'assistant.pages.tv.title', 'assistant.tour.actions.createScreen', '[data-assistant-tour="create-screen"]')
    if (wantsDelete(text)) return sectionAction(path, path, '', 'assistant.pages.tv.title', 'assistant.tour.actions.screenDelete', '[data-assistant-tour="screen-delete"], [data-assistant-tour="screen-list"]')
    if (wantsUnpair(text)) return sectionAction(path, path, '', 'assistant.pages.tv.title', 'assistant.tour.actions.screenUnpair', '[data-assistant-tour="screen-unpair"], [data-assistant-tour="screen-list"]')
    return sectionAction(path, path, '', 'assistant.pages.tv.title', 'assistant.tour.actions.screenEdit', '[data-assistant-tour="screen-settings"], [data-assistant-tour="screen-list"]')
  }
  if (role === 'org_admin' && wantsManage(text) && ['/admin/queues', '/admin/cabinets', '/admin/users'].includes(path) && fallback.length > 1) {
    return { labelKey: 'assistant.action.show', steps: [fallback[1]] }
  }

  return { labelKey: 'assistant.action.showCurrent', steps: fallback.slice(0, 1) }
}
