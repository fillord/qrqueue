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

type CatalogAction = {
  roles: UserRole[]
  path: string
  nav: string
  title: string
  body: string
  selector: string
}

const PROFILE_NAV = '.app-header__profile'
const CATALOG_ACTIONS: Record<string, CatalogAction> = {
  'queue.kiosks': { roles: ['org_admin'], path: '/admin/queue-kiosks', nav: '[href="/admin/queue-kiosks"]', title: 'queueKiosk.title', body: 'queueKiosk.subtitle', selector: '.queue-kiosk-admin__form' },
  'profile.personal': { roles: ['superadmin', 'org_admin', 'operator', 'registrar'], path: '/profile', nav: PROFILE_NAV, title: 'assistant.pages.profile.title', body: 'assistant.tour.actions.profilePersonal', selector: '.profile-card[data-profile-section="personal"]' },
  'profile.password': { roles: ['superadmin', 'org_admin', 'operator', 'registrar'], path: '/profile', nav: PROFILE_NAV, title: 'profile.security', body: 'assistant.tour.actions.profileSecurity', selector: '.profile-card[data-profile-section="security"]' },
  'profile.assistant': { roles: ['superadmin', 'org_admin', 'operator', 'registrar'], path: '/profile', nav: PROFILE_NAV, title: 'assistant.pages.profile.title', body: 'assistant.tour.actions.profileSettings', selector: '.profile-card--assistant' },

  'admin.home': { roles: ['org_admin'], path: '/admin', nav: '[href="/admin"]', title: 'assistant.pages.adminHome.title', body: 'assistant.tour.actions.openSection', selector: '.admin-home' },
  'admin.problems': { roles: ['org_admin'], path: '/admin/problems', nav: '[href="/admin/problems"]', title: 'assistant.pages.problems.title', body: 'assistant.tour.actions.problemFilters', selector: '.admin-problems__filters, .admin-problems' },
  'admin.organization': { roles: ['org_admin'], path: '/admin/organization', nav: '[href="/admin/organization"]', title: 'assistant.pages.organizationSettings.title', body: 'assistant.tour.actions.organizationSettings', selector: '.admin-organization__form' },
  'admin.report': { roles: ['org_admin'], path: '/admin/daily-report', nav: '[href="/admin/daily-report"]', title: 'assistant.pages.adminHome.title', body: 'assistant.tour.actions.openSection', selector: '.admin-report__controls' },
  'admin.analytics': { roles: ['org_admin'], path: '/admin/analytics', nav: '[href="/admin/analytics"]', title: 'assistant.pages.adminHome.title', body: 'assistant.tour.actions.openSection', selector: '.admin-filters' },
  'admin.audit': { roles: ['org_admin'], path: '/admin/audit-logs', nav: '[href="/admin/audit-logs"]', title: 'assistant.pages.adminHome.title', body: 'assistant.tour.actions.openSection', selector: '.admin-filters, .audit-log-filters, .admin-page' },

  'queue.create': { roles: ['org_admin'], path: '/admin/queues', nav: '[href="/admin/queues"]', title: 'assistant.pages.queues.title', body: 'assistant.tour.actions.createQueue', selector: '[data-assistant-tour="create-queue"]' },
  'queue.manage': { roles: ['org_admin'], path: '/admin/queues', nav: '[href="/admin/queues"]', title: 'assistant.pages.queues.title', body: 'assistant.tour.actions.manageRows', selector: '[data-assistant-tour="queue-list"]' },
  'queue.schedule': { roles: ['org_admin'], path: '/admin/queues', nav: '[href="/admin/queues"]', title: 'assistant.pages.schedule.title', body: 'assistant.tour.actions.queueSchedule', selector: '[data-assistant-tour="queue-list"]' },
  'cabinet.create': { roles: ['org_admin'], path: '/admin/cabinets', nav: '[href="/admin/cabinets"]', title: 'assistant.pages.cabinets.title', body: 'assistant.tour.actions.createCabinet', selector: '[data-assistant-tour="create-cabinet"]' },
  'cabinet.manage': { roles: ['org_admin'], path: '/admin/cabinets', nav: '[href="/admin/cabinets"]', title: 'assistant.pages.cabinets.title', body: 'assistant.tour.actions.manageRows', selector: '[data-assistant-tour="cabinet-list"]' },
  'cabinet.assign': { roles: ['org_admin'], path: '/admin/cabinets', nav: '[href="/admin/cabinets"]', title: 'assistant.pages.cabinets.title', body: 'assistant.tour.actions.manageRows', selector: '[data-assistant-tour="cabinet-list"]' },
  'staff.create': { roles: ['org_admin'], path: '/admin/users', nav: '[href="/admin/users"]', title: 'assistant.pages.users.title', body: 'assistant.tour.actions.createUser', selector: '[data-assistant-tour="create-user"]' },
  'staff.manage': { roles: ['org_admin'], path: '/admin/users', nav: '[href="/admin/users"]', title: 'assistant.pages.users.title', body: 'assistant.tour.actions.searchUsers', selector: '.directory__toolbar, .admin-table' },

  'attendance.summary': { roles: ['org_admin'], path: '/admin/attendance', nav: '[href="/admin/attendance"]', title: 'assistant.pages.attendance.title', body: 'assistant.tour.actions.attendanceSummary', selector: '#attendance-summary' },
  'attendance.departments': { roles: ['org_admin'], path: '/admin/attendance/departments', nav: '[href="/admin/attendance/departments"]', title: 'attendanceDirectory.title', body: 'attendanceDirectory.subtitle', selector: '#attendance-departments' },
  'attendance.employee.create': { roles: ['org_admin'], path: '/admin/attendance/employees', nav: '[href="/admin/attendance/employees"]', title: 'assistant.pages.attendance.title', body: 'assistant.tour.actions.attendanceEmployees', selector: '.attendance-admin__create, #attendance-employees' },
  'attendance.employee.import': { roles: ['org_admin'], path: '/admin/attendance/employees', nav: '[href="/admin/attendance/employees"]', title: 'assistant.pages.attendance.title', body: 'assistant.tour.actions.attendanceEmployees', selector: '.attendance-admin__import, #attendance-employees' },
  'attendance.face': { roles: ['org_admin'], path: '/admin/attendance/employees', nav: '[href="/admin/attendance/employees"]', title: 'assistant.pages.attendance.title', body: 'assistant.tour.actions.attendanceEmployees', selector: '#attendance-employees' },
  'attendance.events': { roles: ['org_admin'], path: '/admin/attendance/events', nav: '[href="/admin/attendance/events"]', title: 'assistant.pages.attendance.title', body: 'assistant.tour.actions.attendanceEvents', selector: '#attendance-events' },
  'attendance.enrollment': { roles: ['org_admin'], path: '/admin/attendance/settings', nav: '[href="/admin/attendance/settings"]', title: 'assistant.pages.attendance.title', body: 'assistant.tour.actions.attendanceSettings', selector: '#attendance-settings' },
  'attendance.geo': { roles: ['org_admin'], path: '/admin/attendance/settings', nav: '[href="/admin/attendance/settings"]', title: 'assistant.pages.attendance.title', body: 'assistant.tour.actions.attendanceSettings', selector: '.attendance-admin__geo-form' },
  'attendance.kiosk': { roles: ['org_admin'], path: '/admin/attendance/settings', nav: '[href="/admin/attendance/settings"]', title: 'assistant.pages.attendance.title', body: 'assistant.tour.actions.attendanceSettings', selector: '.attendance-admin__kiosk-create' },

  'tv.create': { roles: ['org_admin'], path: '/admin/tv-screens', nav: '[href="/admin/tv-screens"]', title: 'assistant.pages.tv.title', body: 'assistant.tour.actions.createScreen', selector: '[data-assistant-tour="create-screen"]' },
  'tv.manage': { roles: ['org_admin'], path: '/admin/tv-screens', nav: '[href="/admin/tv-screens"]', title: 'assistant.pages.tv.title', body: 'assistant.tour.actions.screenEdit', selector: '[data-assistant-tour="screen-settings"]' },
  'tv.unpair': { roles: ['org_admin'], path: '/admin/tv-screens', nav: '[href="/admin/tv-screens"]', title: 'assistant.pages.tv.title', body: 'assistant.tour.actions.screenUnpair', selector: '[data-assistant-tour="screen-unpair"], [data-assistant-tour="screen-list"]' },
  'tv.delete': { roles: ['org_admin'], path: '/admin/tv-screens', nav: '[href="/admin/tv-screens"]', title: 'assistant.pages.tv.title', body: 'assistant.tour.actions.screenDelete', selector: '[data-assistant-tour="screen-delete"]' },
  'tv.preview': { roles: ['org_admin'], path: '/admin/tv-screens', nav: '[href="/admin/tv-screens"]', title: 'assistant.pages.tv.title', body: 'assistant.tour.actions.screenEdit', selector: '[data-assistant-tour="screen-settings"]' },
  'signage.schedule.import': { roles: ['org_admin'], path: '/admin/signage', nav: '[href="/admin/signage"]', title: 'assistant.pages.signage.title', body: 'assistant.tour.actions.scheduleImport', selector: '[data-assistant-tour="schedule-import"]' },
  'signage.departments': { roles: ['org_admin'], path: '/admin/signage', nav: '[href="/admin/signage"]', title: 'assistant.pages.signage.title', body: 'assistant.tour.actions.departments', selector: '[data-assistant-tour="departments"]' },
  'signage.media': { roles: ['org_admin'], path: '/admin/signage', nav: '[href="/admin/signage"]', title: 'assistant.pages.signage.title', body: 'assistant.tour.actions.media', selector: '[data-assistant-tour="media"]' },

  'operator.cabinet': { roles: ['operator'], path: '/operator', nav: '[href="/operator"]', title: 'assistant.pages.operator.title', body: 'assistant.tour.actions.chooseCabinet', selector: '.operator-select__grid, .operator-select' },
  'operator.call': { roles: ['operator'], path: '/operator/queue', nav: '[href="/operator/queue"]', title: 'assistant.pages.operatorQueue.title', body: 'assistant.tour.actions.operatorActions', selector: '.operator-queue__current, .operator-queue' },
  'operator.service': { roles: ['operator'], path: '/operator/queue', nav: '[href="/operator/queue"]', title: 'assistant.pages.operatorQueue.title', body: 'assistant.tour.actions.operatorActions', selector: '.operator-queue__current, .operator-queue' },
  'operator.pause': { roles: ['operator'], path: '/operator/queue', nav: '[href="/operator/queue"]', title: 'assistant.pages.operatorQueue.title', body: 'assistant.tour.actions.operatorActions', selector: '.operator-queue' },
  'registrar.ticket': { roles: ['registrar'], path: '/registrar', nav: '[href="/registrar"]', title: 'assistant.pages.registrar.title', body: 'assistant.tour.actions.issueTicket', selector: '.registrar-page__list, .registrar-page' },

  'sa.organizations': { roles: ['superadmin'], path: '/sa/organizations', nav: '[href="/sa/organizations"]', title: 'assistant.pages.organizations.title', body: 'assistant.tour.actions.searchOrganizations', selector: '.directory__toolbar, .admin-table' },
  'sa.organization.create': { roles: ['superadmin'], path: '/sa/organizations', nav: '[href="/sa/organizations"]', title: 'assistant.pages.organizations.title', body: 'assistant.tour.actions.createOrganization', selector: '[data-assistant-tour="create-organization"]' },
  'sa.organization.manage': { roles: ['superadmin'], path: '/sa/organizations', nav: '[href="/sa/organizations"]', title: 'assistant.pages.organizations.title', body: 'assistant.tour.actions.searchOrganizations', selector: '.admin-table, .directory__toolbar' },
  'sa.users': { roles: ['superadmin'], path: '/sa/users', nav: '[href="/sa/users"]', title: 'assistant.pages.allUsers.title', body: 'assistant.tour.actions.searchUsers', selector: '.directory__toolbar, .admin-table' },
  'sa.user.create': { roles: ['superadmin'], path: '/sa/users', nav: '[href="/sa/users"]', title: 'assistant.pages.allUsers.title', body: 'assistant.tour.actions.createUser', selector: '[data-assistant-tour="create-user"]' },
  'sa.trials': { roles: ['superadmin'], path: '/sa/trial-requests', nav: '[href="/sa/trial-requests"]', title: 'assistant.pages.superadmin.title', body: 'assistant.tour.actions.openSection', selector: '.admin-page' },
  'sa.analytics': { roles: ['superadmin'], path: '/sa/analytics', nav: '[href="/sa/analytics"]', title: 'assistant.pages.superadmin.title', body: 'assistant.tour.actions.analytics', selector: '.admin-filters, .admin-page' },
  'sa.audit': { roles: ['superadmin'], path: '/sa/audit-logs', nav: '[href="/sa/audit-logs"]', title: 'assistant.pages.superadmin.title', body: 'assistant.tour.actions.openSection', selector: '.admin-filters, .admin-page' },
}

export function getAssistantActionById(actionId: string | null | undefined, path: string, role: UserRole): AssistantAction | undefined {
  if (!actionId) return undefined
  const action = CATALOG_ACTIONS[actionId]
  if (!action || !action.roles.includes(role)) return undefined
  return sectionAction(action.path, path, action.nav, action.title, action.body, action.selector)
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
    if (has(text, 'терминал', 'ticket kiosk', 'талон басып') || (has(text, 'стойк', 'печать', 'распечат') && has(text, 'талон', 'очеред', 'ticket'))) {
      return sectionAction('/admin/queue-kiosks', path, '[href="/admin/queue-kiosks"]', 'queueKiosk.title', 'queueKiosk.subtitle', '.queue-kiosk-admin__form')
    }
    if ((has(text, 'организац', 'ұйым', 'organization') && has(text, 'настрой', 'назван', 'логотип', 'цвет', 'язык', 'часов', 'setting', 'name', 'logo', 'баптау')) || has(text, 'бренд')) {
      return sectionAction('/admin/organization', path, '[href="/admin/organization"]', 'assistant.pages.organizationSettings.title', 'assistant.tour.actions.organizationSettings', '.admin-organization__form')
    }
    const attendanceDepartmentContext = path.startsWith('/admin/attendance')
      && has(text, 'отделен', 'department', 'бөлімше')
      && !has(text, 'телевиз', 'тв', 'расписан', 'tv', 'schedule')
    if (attendanceDepartmentContext || has(text, 'чек-ин', 'чекин', 'приход', 'уход', 'рабочего времени', 'attendance', 'келу', 'кету')) {
      if (has(text, 'отделен', 'department', 'бөлімше')) return sectionAction('/admin/attendance/departments', path, '[href="/admin/attendance/departments"]', 'attendanceDirectory.title', 'attendanceDirectory.subtitle', '#attendance-departments')
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
