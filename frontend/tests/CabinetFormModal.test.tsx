import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import i18n from '../src/app/i18n'
import CabinetFormModal from '../src/pages/admin/CabinetFormModal'

beforeEach(async () => { await i18n.changeLanguage('ru') })
afterEach(cleanup)

it('uses the visible first queue when queues load after the form opens', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const view = render(<CabinetFormModal queues={[]} onSubmit={onSubmit} onClose={() => {}} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Название кабинета' }), { target: { value: 'Забор крови 108' } })
  view.rerender(<CabinetFormModal
    queues={[{ id: 'queue-1', name: 'Забор крови', status: 'open' }]}
    onSubmit={onSubmit}
    onClose={() => {}}
  />)
  fireEvent.click(screen.getByRole('radio', { name: 'Использовать существующую очередь' }))

  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('queue-1')
  expect((screen.getByRole('button', { name: 'Создать' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
  expect(onSubmit).toHaveBeenCalledWith({ label: 'Забор крови 108', queue_id: 'queue-1' })
})
