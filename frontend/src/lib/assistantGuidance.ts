import type { UserRole } from '../api/types'

export interface AssistantGuidance {
  titleKey: string
  hintKey: string
  promptKey: string
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
