import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

export type DirectoryOption = { value: string; label: string }
export type DirectoryFilter<T> = { key: string; label: string; options: DirectoryOption[]; value: (item: T) => string }
export type DirectorySort<T> = { key: string; label: string; value: (item: T) => string }

export function selectDirectoryItems<T>(items: T[], query: string, search: (item: T) => string, filters: DirectoryFilter<T>[], params: URLSearchParams, sort: DirectorySort<T>, language: string, descending: boolean) {
  const words = query.trim().toLocaleLowerCase(language).split(/\s+/).filter(Boolean)
  const collator = new Intl.Collator(language, { numeric: true, sensitivity: 'base' })
  return items.filter((item) => {
    const text = search(item).toLocaleLowerCase(language)
    return words.every((word) => text.includes(word)) && filters.every((filter) => {
      const selected = params.get(filter.key)
      return !selected || !filter.options.some((option) => option.value === selected) || filter.value(item) === selected
    })
  }).sort((a, b) => collator.compare(sort.value(a), sort.value(b)) * (descending ? -1 : 1))
}

export default function Directory<T>({ items, search, searchLabel, filters = [], sorts, children }: {
  items: T[]; search: (item: T) => string; searchLabel: string; filters?: DirectoryFilter<T>[];
  sorts: DirectorySort<T>[]; children: (items: T[]) => ReactNode;
}) {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const sort = sorts.find((item) => item.key === params.get('sort')) ?? sorts[0]
  const descending = params.get('direction') === 'desc'
  const filtered = selectDirectoryItems(items, query, search, filters, params, sort, i18n.language, descending)
  const pageSize = 20
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const rawPage = Number(params.get('page'))
  const page = Math.min(pages, Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1)
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const hasFilters = query !== '' || filters.some((filter) => params.has(filter.key))
  function change(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }
  function reset() {
    const next = new URLSearchParams(params)
    for (const key of ['q', 'page', ...filters.map((filter) => filter.key)]) next.delete(key)
    setParams(next, { replace: true })
  }
  return <section className="directory" aria-label={searchLabel}>
    <div className="directory__toolbar">
      <label className="directory__search"><span>{t('directory.search')}</span>
        <input type="search" value={query} onChange={(event) => change('q', event.target.value)} placeholder={searchLabel} aria-label={searchLabel} />
      </label>
      {filters.map((filter) => <label key={filter.key}><span>{filter.label}</span>
        <select value={filter.options.some((option) => option.value === params.get(filter.key)) ? params.get(filter.key)! : ''} onChange={(event) => change(filter.key, event.target.value)}>
          <option value="">{t('directory.all')}</option>
          {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>)}
      <label><span>{t('directory.sort')}</span><select value={sort.key} onChange={(event) => change('sort', event.target.value)}>
        {sorts.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select></label>
      <button type="button" className="directory__direction" aria-label={t(descending ? 'directory.desc' : 'directory.asc')} onClick={() => change('direction', descending ? '' : 'desc')}>
        {t(descending ? 'directory.desc' : 'directory.asc')}
      </button>
    </div>
    <div className="directory__summary"><span role="status">{t('directory.count', { count: filtered.length, total: items.length })}</span>
      {hasFilters && <button type="button" onClick={reset}>{t('directory.reset')}</button>}
    </div>
    {filtered.length ? <div className="directory__table" tabIndex={0} role="region" aria-label={t('directory.results')}>{children(visible)}</div> :
      <div className="directory__empty"><h2>{t('directory.empty')}</h2><p>{t(hasFilters ? 'directory.emptyHint' : 'directory.noEntries')}</p>{hasFilters && <button type="button" onClick={reset}>{t('directory.reset')}</button>}</div>}
    {pages > 1 && <nav className="directory__pagination" aria-label={t('directory.pages')}>
      <button type="button" disabled={page === 1} onClick={() => change('page', String(page - 1))}>{t('directory.previous')}</button>
      <span>{t('directory.page', { page, pages })}</span>
      <button type="button" disabled={page === pages} onClick={() => change('page', String(page + 1))}>{t('directory.next')}</button>
    </nav>}
  </section>
}
