import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it } from 'vitest'
import i18n from '../src/app/i18n'
import Directory from '../src/components/Directory'

const items = Array.from({ length: 25 }, (_, index) => ({ id: index, name: `Clinic ${index + 1}`, active: index % 2 === 0 }))
function mount(url = '/') {
  render(<MemoryRouter initialEntries={[url]}><Directory items={items} searchLabel="Find organization" search={(item) => item.name}
    filters={[{ key: 'status', label: 'Status', value: (item) => item.active ? 'active' : 'inactive', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] }]}
    sorts={[{ key: 'name', label: 'Name', value: (item) => item.name }]}>
    {(rows) => <ul>{rows.map((item) => <li key={item.id}>{item.name}</li>)}</ul>}
  </Directory></MemoryRouter>)
}
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)
it('uses natural sorting, pages results, and resets page when searching', () => {
  mount()
  expect(screen.getAllByRole('listitem')).toHaveLength(20)
  expect(screen.getAllByRole('listitem')[1].textContent).toBe('Clinic 2')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' CLINIC 2 ' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(8)
  expect(screen.getByRole('status').textContent).toBe('Found: 8 of 25')
})
it('restores combined filters and sort direction from the URL', () => {
  mount('/?q=clinic&status=active&direction=desc')
  expect(screen.getAllByRole('listitem')).toHaveLength(13)
  expect(screen.getAllByRole('listitem')[0].textContent).toBe('Clinic 25')
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
  expect(screen.getByRole('heading', { name: 'No matches' })).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'Reset filters' })[0])
  expect(screen.getAllByRole('listitem')).toHaveLength(20)
})
it('clamps invalid page values and ignores invalid filter choices', () => {
  mount('/?page=-5&status=unknown')
  expect(screen.getAllByRole('listitem')).toHaveLength(20)
  expect(screen.getByText('Page 1 of 2')).toBeTruthy()
})
