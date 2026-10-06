import { describe, expect, it } from 'vitest'

import { getAssistantAction, getAssistantActionById } from '../src/lib/assistantActions'
import { getAssistantTour } from '../src/lib/assistantGuidance'

function action(question: string, path = '/admin/tv-screens') {
  return getAssistantAction(question, path, 'org_admin', getAssistantTour(path, 'org_admin'))
}

describe('assistant visual actions', () => {
  it('uses a structured catalog action instead of guessing from answer wording', () => {
    const editTv = getAssistantActionById('tv.manage', '/admin/queues', 'org_admin')
    expect(editTv?.destination?.path).toBe('/admin/tv-screens')
    expect(editTv?.destination?.steps[0].selector).toContain('screen-settings')

    const importStaff = getAssistantActionById('attendance.employee.import', '/admin', 'org_admin')
    expect(importStaff?.destination?.path).toBe('/admin/attendance/employees')
    expect(importStaff?.destination?.steps[0].selector).toContain('attendance-admin__import')
  })

  it('rejects catalog actions that do not belong to the current role', () => {
    expect(getAssistantActionById('sa.organization.create', '/admin', 'org_admin')).toBeUndefined()
    expect(getAssistantActionById('tv.manage', '/sa/analytics', 'superadmin')).toBeUndefined()
  })

  it('distinguishes creating a TV from editing an existing TV', () => {
    expect(action('как добавить новый тв').steps[0].selector).toContain('create-screen')
    expect(action('как редактировать тв').steps[0].selector).toContain('screen-settings')
    expect(action('как удалить телевизор').steps[0].selector).toContain('screen-delete')
    expect(action('как отвязать телевизор').steps[0].selector).toContain('screen-unpair')
    expect(action('как изменить название').steps[0].selector).toContain('screen-settings')
  })

  it('routes TV media questions to media instead of TV creation', () => {
    const result = action('как добавить видео на тв', '/admin/queues')
    expect(result.destination?.path).toBe('/admin/signage')
    expect(result.destination?.steps[0].selector).toContain('media')
  })

  it('distinguishes creating and managing queues', () => {
    expect(action('как добавить очередь', '/admin/queues').steps[0].selector).toContain('create-queue')
    expect(action('как редактировать очередь', '/admin/queues').steps[0].selector).toContain('queue-list')
    expect(action('как изменить название', '/admin/queues').steps[0].selector).toContain('queue-list')
  })

  it('opens attendance events for correction questions', () => {
    const result = action('как исправить отметку прихода', '/admin')
    expect(result.destination?.path).toBe('/admin/attendance/events')
    expect(result.destination?.steps[0].selector).toBe('#attendance-events')
  })

  it('opens the independent attendance department directory', () => {
    expect(action('как добавить отделение для учёта рабочего времени', '/admin').destination?.path).toBe('/admin/attendance/departments')
    expect(action('как добавить отделение', '/admin/attendance/employees').destination?.path).toBe('/admin/attendance/departments')
    expect(action('как добавить отделение для тв', '/admin/attendance/departments').destination?.path).toBe('/admin/signage')
    expect(getAssistantActionById('attendance.departments', '/admin', 'org_admin')?.destination?.path).toBe('/admin/attendance/departments')
    expect(getAssistantActionById('attendance.departments', '/sa/analytics', 'superadmin')).toBeUndefined()
  })
})
