import type { UserRole } from '../api/types'

export interface AssistantGuidance {
  titleKey: string
  hintKey: string
  promptKey: string
}

export interface AssistantTourStep {
  selector: string
  titleKey: string
  bodyKey: string
}

const GUIDE: { match: (path: string) => boolean; value: AssistantGuidance }[] = [
  { match: (p) => p === '/profile', value: { titleKey: 'assistant.pages.profile.title', hintKey: 'assistant.pages.profile.hint', promptKey: 'assistant.pages.profile.prompt' } },
  { match: (p) => p === '/admin/problems', value: { titleKey: 'assistant.pages.problems.title', hintKey: 'assistant.pages.problems.hint', promptKey: 'assistant.pages.problems.prompt' } },
  { match: (p) => p === '/admin/tv-screens', value: { titleKey: 'assistant.pages.tv.title', hintKey: 'assistant.pages.tv.hint', promptKey: 'assistant.pages.tv.prompt' } },
  { match: (p) => p === '/admin/signage', value: { titleKey: 'assistant.pages.signage.title', hintKey: 'assistant.pages.signage.hint', promptKey: 'assistant.pages.signage.prompt' } },
  { match: (p) => p.startsWith('/admin/attendance'), value: { titleKey: 'assistant.pages.attendance.title', hintKey: 'assistant.pages.attendance.hint', promptKey: 'assistant.pages.attendance.prompt' } },
  { match: (p) => p === '/admin/users', value: { titleKey: 'assistant.pages.users.title', hintKey: 'assistant.pages.users.hint', promptKey: 'assistant.pages.users.prompt' } },
  { match: (p) => p === '/admin/queues', value: { titleKey: 'assistant.pages.queues.title', hintKey: 'assistant.pages.queues.hint', promptKey: 'assistant.pages.queues.prompt' } },
  { match: (p) => p.startsWith('/admin/queues/'), value: { titleKey: 'assistant.pages.schedule.title', hintKey: 'assistant.pages.schedule.hint', promptKey: 'assistant.pages.schedule.prompt' } },
  { match: (p) => p === '/admin/cabinets', value: { titleKey: 'assistant.pages.cabinets.title', hintKey: 'assistant.pages.cabinets.hint', promptKey: 'assistant.pages.cabinets.prompt' } },
  { match: (p) => p === '/admin/organization', value: { titleKey: 'assistant.pages.organizationSettings.title', hintKey: 'assistant.pages.organizationSettings.hint', promptKey: 'assistant.pages.organizationSettings.prompt' } },
  { match: (p) => p === '/admin', value: { titleKey: 'assistant.pages.adminHome.title', hintKey: 'assistant.pages.adminHome.hint', promptKey: 'assistant.pages.adminHome.prompt' } },
  { match: (p) => p === '/sa/organizations' || p.startsWith('/sa/organizations/'), value: { titleKey: 'assistant.pages.organizations.title', hintKey: 'assistant.pages.organizations.hint', promptKey: 'assistant.pages.organizations.prompt' } },
  { match: (p) => p === '/sa/users', value: { titleKey: 'assistant.pages.allUsers.title', hintKey: 'assistant.pages.allUsers.hint', promptKey: 'assistant.pages.allUsers.prompt' } },
  { match: (p) => p.startsWith('/sa/'), value: { titleKey: 'assistant.pages.superadmin.title', hintKey: 'assistant.pages.superadmin.hint', promptKey: 'assistant.pages.superadmin.prompt' } },
  { match: (p) => p === '/operator/queue', value: { titleKey: 'assistant.pages.operatorQueue.title', hintKey: 'assistant.pages.operatorQueue.hint', promptKey: 'assistant.pages.operatorQueue.prompt' } },
  { match: (p) => p === '/operator', value: { titleKey: 'assistant.pages.operator.title', hintKey: 'assistant.pages.operator.hint', promptKey: 'assistant.pages.operator.prompt' } },
  { match: (p) => p === '/registrar', value: { titleKey: 'assistant.pages.registrar.title', hintKey: 'assistant.pages.registrar.hint', promptKey: 'assistant.pages.registrar.prompt' } },
]

export function getAssistantGuidance(path: string, role: UserRole): AssistantGuidance {
  const exact = GUIDE.find((item) => item.match(path))
  if (exact) return exact.value
  return {
    titleKey: `assistant.roles.${role}.title`,
    hintKey: `assistant.roles.${role}.hint`,
    promptKey: 'assistant.defaultPrompt',
  }
}

const pageStep = (selector: string, page: string, action: string): AssistantTourStep => ({
  selector,
  titleKey: `assistant.pages.${page}.title`,
  bodyKey: `assistant.tour.actions.${action}`,
})

export function getAssistantTour(path: string, role: UserRole): AssistantTourStep[] {
  if (path === '/profile') return [
    pageStep('.profile-card[data-profile-section="personal"]', 'profile', 'profilePersonal'),
    pageStep('.profile-card[data-profile-section="security"]', 'profile', 'profileSecurity'),
    pageStep('.profile-card--assistant', 'profile', 'profileSettings'),
  ]
  if (path === '/admin/problems') return [pageStep('.admin-problems__filters', 'problems', 'problemFilters')]
  if (path === '/admin/tv-screens') return [
    pageStep('[data-assistant-tour="create-screen"]', 'tv', 'createScreen'),
    pageStep('[data-assistant-tour="screen-list"], .admin-tv-screens', 'tv', 'screenSettings'),
  ]
  if (path === '/admin/signage') return [
    pageStep('[data-assistant-tour="schedule-import"]', 'signage', 'scheduleImport'),
    pageStep('[data-assistant-tour="departments"]', 'signage', 'departments'),
    pageStep('[data-assistant-tour="media"]', 'signage', 'media'),
  ]
  if (path.startsWith('/admin/attendance')) return [
    pageStep('.attendance-admin__create', 'attendance', 'attendanceEmployees'),
    pageStep('#attendance-events', 'attendance', 'attendanceEvents'),
  ]
  if (path === '/admin/users') return [
    pageStep('[data-assistant-tour="create-user"]', 'users', 'createUser'),
    pageStep('.directory__toolbar', 'users', 'searchUsers'),
  ]
  if (path === '/admin/queues') return [
    pageStep('[data-assistant-tour="create-queue"]', 'queues', 'createQueue'),
    pageStep('[data-assistant-tour="queue-list"], .admin-page', 'queues', 'manageRows'),
  ]
  if (path.startsWith('/admin/queues/')) return [pageStep('.admin-page form, .admin-page', 'schedule', 'queueSchedule')]
  if (path === '/admin/cabinets') return [
    pageStep('[data-assistant-tour="create-cabinet"]', 'cabinets', 'createCabinet'),
    pageStep('[data-assistant-tour="cabinet-list"], .admin-page', 'cabinets', 'manageRows'),
  ]
  if (path === '/admin/organization') return [pageStep('.admin-organization__form', 'organizationSettings', 'organizationSettings')]
  if (path === '/admin') return [
    pageStep('[href="/admin/problems"]', 'problems', 'openSection'),
    pageStep('[href="/admin/queues"]', 'queues', 'openSection'),
    pageStep('[href="/admin/cabinets"]', 'cabinets', 'openSection'),
    pageStep('[href="/admin/tv-screens"]', 'tv', 'openSection'),
  ]
  if (path === '/sa/organizations' || path.startsWith('/sa/organizations/')) return [
    pageStep('[data-assistant-tour="create-organization"], .admin-page__back', 'organizations', 'createOrganization'),
    pageStep('.directory__toolbar, .admin-table', 'organizations', 'searchOrganizations'),
  ]
  if (path === '/sa/users') return [
    pageStep('[data-assistant-tour="create-user"]', 'allUsers', 'createUser'),
    pageStep('.directory__toolbar', 'allUsers', 'searchUsers'),
  ]
  if (path.startsWith('/sa/')) return [
    pageStep('[href="/sa/organizations"]', 'organizations', 'openSection'),
    pageStep('[href="/sa/users"]', 'allUsers', 'openSection'),
    pageStep('[href="/sa/analytics"]', 'superadmin', 'analytics'),
  ]
  if (path === '/operator/queue') return [pageStep('.operator-queue__current', 'operatorQueue', 'operatorActions')]
  if (path === '/operator') return [pageStep('.operator-select__grid, .operator-select', 'operator', 'chooseCabinet')]
  if (path === '/registrar') return [pageStep('.registrar-page__list, .registrar-page', 'registrar', 'issueTicket')]

  const roleStart: Record<UserRole, AssistantTourStep[]> = {
    superadmin: [pageStep('[href="/sa/organizations"], main', 'superadmin', 'openSection')],
    org_admin: [pageStep('[href="/admin/queues"], main', 'adminHome', 'openSection')],
    operator: [pageStep('main', 'operator', 'chooseCabinet')],
    registrar: [pageStep('main', 'registrar', 'issueTicket')],
  }
  return roleStart[role]
}
