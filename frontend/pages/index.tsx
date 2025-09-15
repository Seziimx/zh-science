import { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import SourceBadge from '../components/SourceBadge'
import FacetMultiSelect from '../components/FacetMultiSelect'
import { useI18n, Lang } from '../lib/i18n'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'



type AuthorOut = { id: number; display_name: string }
type SourceOut = { id: number; name: string; type?: string | null; issn?: string | null; sjr_quartile?: string | null }
type PublicationOut = {
  id: number;
  year: number;
  title: string;
  doi?: string | null;
  scopus_url?: string | null;
  pdf_url?: string | null;
  citations_count: number;
  quartile?: string | null;
  percentile_2024?: number | null;
  source?: SourceOut | null;
  authors: AuthorOut[];
}
type SearchResponse = { meta: { page: number; per_page: number; total: number; total_pages: number }; items: PublicationOut[] }

export default function HomePage() {
  const [lang, setLang] = useState<Lang>('ru')
  const t = useI18n(lang)
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? (localStorage.getItem('lang') as Lang | null) : null
    if (saved === 'ru' || saved === 'kz') setLang(saved)
  }, [])
  const [q, setQ] = useState('')
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SearchResponse | null>(null)
  // sidebar filters
  const [yearMin, setYearMin] = useState<number | ''>('')
  const [yearMax, setYearMax] = useState<number | ''>('')
  const [issn, setIssn] = useState('')
  const [quartiles, setQuartiles] = useState<string[]>([])
  const [citMin, setCitMin] = useState<number | ''>('')
  const [citMax, setCitMax] = useState<number | ''>('')
  const [pMin, setPMin] = useState<number | ''>('')
  const [pMax, setPMax] = useState<number | ''>('')
  const [sort, setSort] = useState('year_desc')
  const [authorIds, setAuthorIds] = useState<number[]>([])

  const startIndex = useMemo(() => (page - 1) * perPage + 1, [page, perPage])

  const fetchData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) })
      if (q.trim()) params.set('q', q.trim())
      if (yearMin !== '') params.set('year_min', String(yearMin))
      if (yearMax !== '') params.set('year_max', String(yearMax))
      if (issn.trim()) params.set('issn', issn.trim())
      quartiles.forEach(qt => params.append('quartiles', qt))
      if (citMin !== '') params.set('citations_min', String(citMin))
      if (citMax !== '') params.set('citations_max', String(citMax))
      if (pMin !== '') params.set('percentile_min', String(pMin))
      if (pMax !== '') params.set('percentile_max', String(pMax))
      if (sort) params.set('sort', sort)
      authorIds.forEach(id => params.append('authors', String(id)))
      const res = await fetch(`${API_BASE}/search?${params.toString()}`)
      const json: SearchResponse = await res.json()
      setData(json)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Initial load and when page changes
  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // Auto-refresh when filters (except q) change
  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearMin, yearMax, issn, quartiles.join(','), citMin, citMax, pMin, pMax, sort, authorIds.join(','), perPage])

  // Refresh when window gets focus or becomes visible (e.g., after approving in admin)
  useEffect(() => {
    const onFocus = () => fetchData()
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchData() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchData()
  }

  const toggleQuartile = (qv: string) => {
    setQuartiles(prev => prev.includes(qv) ? prev.filter(x => x !== qv) : [...prev, qv])
  }

  return (
    <>
      <Head>
        <title>Science-ARSU</title>
      </Head>
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t('siteTitle')} — {t('menu.search')}</h1>
          <a href="/add" className="rounded bg-primary px-4 py-2 text-white">Загрузить публикацию</a>
        </div>

        <form onSubmit={onSubmit} className="relative">
          <input
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 pr-12 outline-none focus:ring-2 focus:ring-primary"
            placeholder={t('search.placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-primary px-3 py-1 text-white">
            🔍
          </button>
        </form>

        <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
          <div>{loading ? 'Загрузка…' : `${t('search.found')}: ${data?.meta.total ?? 0}`}</div>
          <div className="inline-flex overflow-hidden rounded border">
            <button className={`px-3 py-1 ${view === 'table' ? 'bg-primary text-white' : 'bg-white'}`} onClick={() => setView('table')} type="button">{t('search.table')}</button>
            <button className={`px-3 py-1 ${view === 'cards' ? 'bg-primary text-white' : 'bg-white'}`} onClick={() => setView('cards')} type="button">{t('search.cards')}</button>
          </div>
        </div>

        <hr className="my-3" />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Sidebar */}
          <aside className="lg:col-span-4 xl:col-span-3 space-y-3">
            {/* Authors facet */}
            <FacetMultiSelect
              title={lang==='kz'?'Авторлар':'Авторы'}
              endpoint="authors"
              params={{
                q: q.trim() || undefined,
                year_min: yearMin || undefined,
                year_max: yearMax || undefined,
                issn: issn.trim() || undefined,
                quartiles: quartiles,
                citations_min: citMin === '' ? undefined : citMin,
                citations_max: citMax === '' ? undefined : citMax,
                percentile_min: pMin === '' ? undefined : pMin,
                percentile_max: pMax === '' ? undefined : pMax,
              }}
              selected={authorIds}
              setSelected={setAuthorIds}
            />
            <div className="rounded border bg-white p-3">
              <div className="mb-2 font-semibold">{t('search.filters')}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500">{t('search.yearFrom')}</label>
                  <input className="w-full rounded border px-2 py-1" type="number" value={yearMin} onChange={e=>setYearMin(e.target.value?Number(e.target.value):'')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">{t('search.yearTo')}</label>
                  <input className="w-full rounded border px-2 py-1" type="number" value={yearMax} onChange={e=>setYearMax(e.target.value?Number(e.target.value):'')} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500">{t('search.issn')}</label>
                  <input className="w-full rounded border px-2 py-1" placeholder="1234-5678" value={issn} onChange={e=>setIssn(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-gray-500 mb-1">{t('search.quartile')}</div>
                  <div className="flex flex-wrap gap-2">
                    {['Q1','Q2','Q3','Q4'].map(qv => (
                      <label key={qv} className={`cursor-pointer rounded border px-2 py-0.5 text-xs ${quartiles.includes(qv)?'bg-primary text-white':'bg-white'}`}>
                        <input type="checkbox" className="hidden" checked={quartiles.includes(qv)} onChange={()=>toggleQuartile(qv)} />{qv}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500">{t('search.citFrom')}</label>
                  <input className="w-full rounded border px-2 py-1" type="number" value={citMin} onChange={e=>setCitMin(e.target.value?Number(e.target.value):'')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">{t('search.citTo')}</label>
                  <input className="w-full rounded border px-2 py-1" type="number" value={citMax} onChange={e=>setCitMax(e.target.value?Number(e.target.value):'')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">{t('search.percFrom')}</label>
                  <input className="w-full rounded border px-2 py-1" type="number" value={pMin} onChange={e=>setPMin(e.target.value?Number(e.target.value):'')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">{t('search.percTo')}</label>
                  <input className="w-full rounded border px-2 py-1" type="number" value={pMax} onChange={e=>setPMax(e.target.value?Number(e.target.value):'')} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500">{t('search.sort')}</label>
                  <select className="w-full rounded border px-2 py-1" value={sort} onChange={e=>setSort(e.target.value)}>
                    <option value="year_desc">{t('search.yearTo')} ↓</option>
                    <option value="year_asc">{t('search.yearFrom')} ↑</option>
                    <option value="citations_desc">{t('search.citations')} ↓</option>
                    <option value="citations_asc">{t('search.citations')} ↑</option>
                    <option value="title_asc">A–Z</option>
                    <option value="title_desc">Z–A</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="rounded bg-primary px-3 py-1 text-white" onClick={()=>{setPage(1);fetchData()}} type="button">{t('search.apply')}</button>
                <button className="rounded border px-3 py-1" type="button" onClick={()=>{
                  // Clear all filters including query and selected authors
                  setQ('');
                  setAuthorIds([]);
                  setYearMin('');
                  setYearMax('');
                  setIssn('');
                  setQuartiles([]);
                  setCitMin('');
                  setCitMax('');
                  setPMin('');
                  setPMax('');
                  setSort('year_desc');
                  setPage(1);
                  fetchData();
                }}>{t('search.reset')}</button>
              </div>
              <div className="mt-3">
                <button
                  className="rounded border px-3 py-1"
                  type="button"
                  onClick={() => {
                    const sp = new URLSearchParams()
                    if (q.trim()) sp.set('q', q.trim())
                    if (yearMin !== '') sp.set('year_min', String(yearMin))
                    if (yearMax !== '') sp.set('year_max', String(yearMax))
                    if (issn.trim()) sp.set('issn', issn.trim())
                    quartiles.forEach(qt => sp.append('quartiles', qt))
                    if (citMin !== '') sp.set('citations_min', String(citMin))
                    if (citMax !== '') sp.set('citations_max', String(citMax))
                    if (pMin !== '') sp.set('percentile_min', String(pMin))
                    if (pMax !== '') sp.set('percentile_max', String(pMax))
                    if (authorIds.length) authorIds.forEach(id => sp.append('authors', String(id)))
                    window.open(`${API_BASE}/search/export?${sp.toString()}`, '_blank')
                  }}
                >{t('search.exportCsv')}</button>
                <button
                  className="ml-2 rounded border px-3 py-1"
                  type="button"
                  onClick={() => {
                    const sp = new URLSearchParams()
                    if (q.trim()) sp.set('q', q.trim())
                    if (yearMin !== '') sp.set('year_min', String(yearMin))
                    if (yearMax !== '') sp.set('year_max', String(yearMax))
                    if (issn.trim()) sp.set('issn', issn.trim())
                    quartiles.forEach(qt => sp.append('quartiles', qt))
                    if (citMin !== '') sp.set('citations_min', String(citMin))
                    if (citMax !== '') sp.set('citations_max', String(citMax))
                    if (pMin !== '') sp.set('percentile_min', String(pMin))
                    if (pMax !== '') sp.set('percentile_max', String(pMax))
                    if (authorIds.length) authorIds.forEach(id => sp.append('authors', String(id)))
                    sp.set('fmt', 'xlsx')
                    window.open(`${API_BASE}/search/export?${sp.toString()}`, '_blank')
                  }}
                >Экспорт XLSX</button>
              </div>
            </div>
          </aside>

          {/* Results */}
          <section className="lg:col-span-8 xl:col-span-9 space-y-3">
        {view === 'table' ? (
          <div className="rounded-md border bg-white">
            <table className="min-w-full text-sm table-auto">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">№</th>
                  <th className="px-3 py-2 text-left">Год</th>
                  <th className="px-3 py-2 text-left w-80">Авторы</th>
                  <th className="px-3 py-2 text-left">Название</th>
                  <th className="px-3 py-2 text-left">Источник</th>
                  <th className="px-3 py-2 text-left">Ссылки (Scopus/DOI)</th>
                  <th className="px-3 py-2 text-left">Цит.</th>
                  <th className="px-3 py-2 text-left">Quartile</th>
                  <th className="px-3 py-2 text-left">Perc. 2024</th>
                  <th className="px-3 py-2 text-left">Файл</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((pub, idx) => (
                  <tr key={pub.id} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2">{startIndex + idx}</td>
                    <td className="px-3 py-2">{pub.year}</td>
                    <td className="px-3 py-2 whitespace-pre-line break-words w-80">{pub.authors.map(a => a.display_name.replace(/\s*\([^)]*\)\s*/g, '').trim()).join('\n')}</td>
                    <td className="px-3 py-2 whitespace-normal break-words">{pub.title}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span>{pub.source?.name ?? ''}</span>
                        <SourceBadge name={pub.source?.name} type={pub.source?.type ?? undefined} />
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-pre-line break-words">
                      {pub.scopus_url && (
                        <a className="text-primary underline block" href={pub.scopus_url} target="_blank" rel="noreferrer">Scopus</a>
                      )}
                      {pub.doi && (
                        <a className="text-primary underline block" href={`https://doi.org/${pub.doi}`} target="_blank" rel="noreferrer">DOI</a>
                      )}
                    </td>
                    <td className="px-3 py-2">{pub.citations_count}</td>
                    <td className="px-3 py-2">{pub.quartile ?? ''}</td>
                    <td className="px-3 py-2">{pub.percentile_2024 ?? ''}</td>
                    <td className="px-3 py-2">
                      {pub.pdf_url && (
                        <a className="text-primary underline" href={`${API_BASE}/publications/${pub.id}/download`} target="_blank" rel="noreferrer">Скачать</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(data?.items ?? []).map((pub, idx) => (
              <div key={pub.id} className="rounded-md border bg-white p-3">
                <div className="text-xs text-gray-500">#{startIndex + idx} • {pub.year}</div>
                <div className="mt-1 text-lg font-semibold">{pub.title}</div>
                <div className="mt-1 whitespace-pre-line text-sm text-gray-600 break-words">
                  {pub.authors.map(a => a.display_name.replace(/\s*\([^)]*\)\s*/g, '').trim()).join('\n')}
                </div>
                <div className="mt-1 text-sm flex items-center gap-2">
                  <span>Источник: {pub.source?.name ?? '-'}</span>
                  <SourceBadge name={pub.source?.name} type={pub.source?.type ?? undefined} />
                </div>
                <div className="mt-1 flex gap-4 text-sm flex-wrap">
                  {pub.scopus_url && (<a className="text-primary underline" href={pub.scopus_url} target="_blank" rel="noreferrer">Scopus</a>)}
                  {pub.doi && (<a className="text-primary underline" href={`https://doi.org/${pub.doi}`} target="_blank" rel="noreferrer">DOI</a>)}
                  {pub.pdf_url && (
                    <a className="text-primary underline block" href={`${API_BASE}/publications/${pub.id}/download`} target="_blank" rel="noreferrer">Скачать</a>
                  )}
                </div>
                <div className="mt-1 flex gap-4 text-xs text-gray-600">
                  <span>Цит.: {pub.citations_count}</span>
                  <span>Quartile: {pub.quartile ?? '-'}</span>
                  <span>Perc.: {pub.percentile_2024 ?? '-'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="my-4 flex items-center justify-center gap-2">
          <button
            className="rounded border px-3 py-1 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={(data?.meta.page ?? 1) <= 1}
          >
            Назад
          </button>
          <div className="text-sm">{data?.meta.page ?? 1} / {data?.meta.total_pages ?? 1}</div>
          <button
            className="rounded border px-3 py-1 disabled:opacity-50"
            onClick={() => setPage((p) => Math.min((data?.meta.total_pages ?? 1), p + 1))}
            disabled={(data?.meta.page ?? 1) >= (data?.meta.total_pages ?? 1)}
          >
            Вперёд
          </button>
        </div>
          </section>
        </div>
      </div>
    </>
  )
}
