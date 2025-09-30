import { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import SourceBadge from '../components/SourceBadge'
import FacetMultiSelect from '../components/FacetMultiSelect'
import { useI18n, Lang } from '../lib/i18n'
import { authHeaders } from '../lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

// Reuse types from index page signature

type AuthorOut = { id: number; display_name: string }
type SourceOut = { id: number; name: string; type?: string | null; issn?: string | null; sjr_quartile?: string | null }
type PublicationOut = {
  id: number;
  year: number;
  title: string;
  doi?: string | null;
  scopus_url?: string | null;
  url?: string | null;
  language?: string | null;
  pdf_url?: string | null;
  doc_type?: string | null;
  upload_source?: string | null;
  citations_count: number;
  quartile?: string | null;
  percentile_2024?: number | null;
  source?: SourceOut | null;
  authors: AuthorOut[];
  main_authors_count?: number | null;
  status: string;
  note?: string | null;
}

type SearchResponse = PublicationOut[]

export default function KoksoPage() {
  const [lang, setLang] = useState<Lang>('ru')
  const t = useI18n(lang)
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? (localStorage.getItem('lang') as Lang | null) : null
    if (saved === 'ru' || saved === 'kz') setLang(saved)
  }, [])

  const [q, setQ] = useState('')
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SearchResponse | null>(null)
  const [yearMin, setYearMin] = useState<number | ''>('')
  const [yearMax, setYearMax] = useState<number | ''>('')
  const [issn, setIssn] = useState<string>('')
  const [sort, setSort] = useState<string>('year_desc')
  const [authorIds, setAuthorIds] = useState<number[]>([])
  const [docType, setDocType] = useState<string>('')
  const [kokLang, setKokLang] = useState<''|'ru'|'kz'|'en'>('')
  const [faculty, setFaculty] = useState<string>('')

  // role guard: hide page for guests
  const [role, setRole] = useState<'guest'|'user'|'admin'>('guest')
  useEffect(()=>{
    if (typeof window !== 'undefined') {
      const r = (localStorage.getItem('role') as any) || 'guest'
      setRole(r)
    }
  }, [])

  const startIndex = useMemo(() => 1, [])

  // derived pagination items
  const items = useMemo(() => (data ?? []), [data])
  const totalPages = Math.max(1, Math.ceil(items.length / perPage))
  const pageItems = useMemo(() => {
    const start = (page - 1) * perPage
    return items.slice(start, start + perPage)
  }, [items, page, perPage])
  useEffect(()=>{ if (page>totalPages) setPage(totalPages) }, [totalPages])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (yearMin !== '') params.set('year_min', String(yearMin))
      if (yearMax !== '') params.set('year_max', String(yearMax))
      if (issn.trim()) params.set('issn', issn.trim())
      if (kokLang) params.set('lang', kokLang)
      if (sort) params.set('sort', sort)
      if (docType) params.set('doc_type', docType)
      if (faculty) params.set('faculty', faculty)
      // fetch only approved items by default to reduce payload
      params.set('status', 'approved')
      if (authorIds.length) authorIds.forEach(id => params.append('authors', String(id)))
      // add timeout via AbortController
      const ctrl = new AbortController()
      const t = window.setTimeout(() => ctrl.abort(), 20000)
      const res = await fetch(`${API_BASE}/publications/kokson?${params.toString()}`, { headers: authHeaders(), signal: ctrl.signal })
      window.clearTimeout(t)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json: any = await res.json()
      setData(Array.isArray(json) ? json as SearchResponse : (json?.items || []))
    } catch (e) {
      console.error(e)
      setError((e as any)?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (role!=='guest') fetchData() }, [])
  useEffect(() => { if (role!=='guest') fetchData() }, [role])

  // Auto-refetch when any filter changes
  useEffect(() => {
    if (role !== 'guest') fetchData()
  }, [q, yearMin, yearMax, issn, sort, kokLang, docType, faculty, authorIds.join(',')])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    fetchData()
  }

  const onReset = () => {
    setYearMin(''); setYearMax(''); setIssn(''); setKokLang(''); setSort('year_desc'); setAuthorIds([]); setFaculty(''); setDocType('');
    setQ('');
    fetchData()
  }

  async function onExport(fmt: 'xlsx'|'csv') {
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (yearMin !== '') params.set('year_min', String(yearMin))
      if (yearMax !== '') params.set('year_max', String(yearMax))
      if (issn.trim()) params.set('issn', issn.trim())
      if (kokLang) params.set('lang', kokLang)
      if (sort) params.set('sort', sort)
      if (docType) params.set('doc_type', docType)
      if (faculty) params.set('faculty', faculty)
      params.set('fmt', fmt)
      const res = await fetch(`${API_BASE}/publications/kokson/export?${params.toString()}`, { headers: authHeaders() })
      if (!res.ok) { alert(await res.text()); return }
      const blob = await res.blob()
      // derive filename from Content-Disposition if present
      const cd = res.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename=([^;]+)/i)
      const fallback = fmt === 'xlsx' ? 'Koksost.xlsm' : 'Koksost.csv'
      const filename = m ? decodeURIComponent(m[1].replace(/"/g, '')) : fallback
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e:any) {
      alert(e.message || String(e))
    }
  }

  if (role === 'guest') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Head><title>Статьи — доступ только для пользователей</title></Head>
        <h1 className="text-2xl font-bold mb-2">Статьи</h1>
        <p className="text-sm text-gray-700">Доступ к этой странице только для авторизованных пользователей. Пожалуйста, выберите роль вверху сайта (user/admin) и введите пароль.</p>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>Статьи — {t('siteTitle')}</title>
      </Head>
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Статьи</h1>
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
          <div>{loading ? 'Загрузка…' : error ? `Ошибка: ${error}` : `${t('search.found')}: ${data ? data.length : 0}`}</div>
          <div className="inline-flex overflow-hidden rounded border">
            <button className={`px-3 py-1 ${view === 'table' ? 'bg-primary text-white' : 'bg-white'}`} onClick={() => setView('table')} type="button">{t('search.table')}</button>
            <button className={`px-3 py-1 ${view === 'cards' ? 'bg-primary text-white' : 'bg-white'}`} onClick={() => setView('cards')} type="button">{t('search.cards')}</button>
          </div>
          <div className="flex items-center gap-2 ml-2 text-sm">
            <span>На странице</span>
            <select className="rounded border px-2 py-1" value={perPage} onChange={(e)=>{ setPerPage(Number(e.target.value)); setPage(1) }}>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        <hr className="my-3" />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Sidebar */}
          <aside className="lg:col-span-4 xl:col-span-3 space-y-3">
            {/* Authors facet (Kokson only) */}
            <FacetMultiSelect
              title={'Авторы (Статьи)'}
              endpoint="authors"
              params={{
                upload_source: 'kokson',
                q: q.trim() || undefined,
                year_min: yearMin || undefined,
                year_max: yearMax || undefined,
                issn: issn.trim() || undefined,
              }}
              selected={authorIds}
              setSelected={setAuthorIds}
            />
            <div className="rounded border bg-white p-3">
              <div className="mb-2 font-semibold">Фильтры</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500">Год от</label>
                  <input className="w-full rounded border px-2 py-1" type="number" value={yearMin} onChange={e=>setYearMin(e.target.value?Number(e.target.value):'')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Год до</label>
                  <input className="w-full rounded border px-2 py-1" type="number" value={yearMax} onChange={e=>setYearMax(e.target.value?Number(e.target.value):'')} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500">ISSN</label>
                  <input className="w-full rounded border px-2 py-1" placeholder="1234-5678" value={issn} onChange={e=>setIssn(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Язык</label>
                  <select className="w-full rounded border px-2 py-1" value={kokLang} onChange={e=>setKokLang(e.target.value as any)}>
                    <option value="">Все</option>
                    <option value="ru">Русский</option>
                    <option value="kz">Қазақша</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Факультет</label>
                  <select className="w-full rounded border px-2 py-1" value={faculty} onChange={e=>setFaculty(e.target.value)}>
                    <option value="">Все</option>
                    <option value="Без привязки">Без привязки</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500">Тип публикации</label>
                  <select className="w-full rounded border px-2 py-1" value={docType} onChange={e=>setDocType(e.target.value)}>
                    <option value="">Все</option>
                    <option>БҒСБК(ККСОН) тізіміндегі журнал</option>
                    <option>Ғылыми журнал</option>
                    <option>Әдістемелік нұсқаулар</option>
                    <option>Оқу-әдістемелік құрал</option>
                    <option>Танымдық жинақ</option>
                    <option>Энциклопедия</option>
                    <option>Монография</option>
                    <option>Шығармалар жинағы</option>
                    <option>Аймақтық</option>
                    <option>Халықаралық</option>
                    <option>Шетелдік</option>
                    <option>Международный</option>
                    <option>Республикалық</option>
                    <option>Авторлық куәлік</option>
                    <option>Патент</option>
                    <option>Конференциялар жинағы</option>
                    <option>Кітаптар</option>
                  </select>
                </div>
                {/* Authors facet removed by request */}
                <div>
                  <label className="block text-xs text-gray-500">Сортировка</label>
                  <select className="w-full rounded border px-2 py-1" value={sort} onChange={e=>setSort(e.target.value)}>
                    <option value="year_desc">Год ↓</option>
                    <option value="year_asc">Год ↑</option>
                    <option value="title_asc">A–Z</option>
                    <option value="title_desc">Z–A</option>
                    <option value="type_asc">Тип A–Я</option>
                    <option value="type_desc">Тип Я–A</option>
                    <option value="author_asc">Автор A–Я</option>
                    <option value="author_desc">Автор Я–A</option>
                  </select>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button className="rounded border px-3 py-1 text-sm" onClick={onSubmit}>Применить</button>
                <button className="rounded border px-3 py-1 text-sm" onClick={onReset}>Сбросить</button>
                <button className="rounded border px-3 py-1 text-sm whitespace-nowrap" onClick={()=>onExport('xlsx')}>Экспорт XLSX</button>
                <button className="rounded border px-3 py-1 text-sm whitespace-nowrap" onClick={()=>onExport('csv')}>CSV</button>
              </div>
            </div>
          </aside>

          {/* Results */}
          <section className="lg:col-span-8 xl:col-span-9 space-y-3">
            {view === 'table' ? (
              <div className="rounded-md border bg-white">
                <table className="min-w-full text-sm table-fixed">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">№</th>
                      <th className="px-3 py-2 text-left">Год</th>
                      <th className="px-3 py-2 text-left w-60">Авторы</th>
                      <th className="px-3 py-2 text-left w-60">Соавторы</th>
                      <th className="px-3 py-2 text-left">Название</th>
                      <th className="px-3 py-2 text-left w-72">Источник</th>
                      <th className="px-3 py-2 text-left">Ссылки (Scopus/DOI)</th>
                      <th className="px-3 py-2 text-left">Язык</th>
                      <th className="px-3 py-2 text-left">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((pub, idx) => (
                      <tr key={pub.id} className="odd:bg-white even:bg-gray-50">
                        <td className="px-3 py-2">{(page-1)*perPage + startIndex + idx}</td>
                        <td className="px-3 py-2">{pub.year}</td>
                        <td className="px-3 py-2 whitespace-pre-line break-words w-60">
                          {(() => {
                            const mainCount = Math.max(0, Math.min(pub.authors.length, (pub.main_authors_count ?? pub.authors.length)))
                            return pub.authors.slice(0, mainCount).map((a, i) => (
                            <span key={a.id}>
                              <Link className="text-blue-600 hover:underline" href={`/author/${a.id}`}>
                                {a.display_name.replace(/\s*\([^)]*\)\s*/g, '').trim()}
                              </Link>
                              {i < mainCount - 1 ? <><br/></> : null}
                            </span>
                          ))
                          })()}
                        </td>
                        <td className="px-3 py-2 whitespace-pre-line break-words w-60">
                          {(() => {
                            const mainCount = Math.max(0, Math.min(pub.authors.length, (pub.main_authors_count ?? pub.authors.length)))
                            const rest = pub.authors.slice(mainCount)
                            return rest.map((a, i) => (
                            <span key={a.id}>
                              <Link className="text-blue-600 hover:underline" href={`/author/${a.id}`}>
                                {a.display_name.replace(/\s*\([^)]*\)\s*/g, '').trim()}
                              </Link>
                              {i < rest.length - 1 ? <><br/></> : null}
                            </span>
                          ))
                          })()}
                        </td>
                        <td className="px-3 py-2 whitespace-pre-wrap break-words hyphens-auto leading-relaxed">{pub.title}</td>
                        <td className="px-3 py-2 whitespace-pre-wrap break-words hyphens-auto leading-relaxed w-72">
                          <div className="flex items-start gap-2">
                            <span className="whitespace-pre-wrap break-words hyphens-auto">{pub.source?.name ?? ''}</span>
                            <SourceBadge name={pub.source?.name} type={pub.source?.type ?? undefined} docType={pub.doc_type ?? undefined} uploadSource={pub.upload_source ?? undefined} />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {pub.scopus_url ? <a className="text-primary underline" href={pub.scopus_url} target="_blank" rel="noreferrer">Scopus</a> : null}
                            {pub.doi ? <a className="text-primary underline" href={`https://doi.org/${pub.doi}`} target="_blank" rel="noreferrer">DOI</a> : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">{pub.language || '-'}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {/* PDF (полная ссылка) */}
                            {(() => {
                              const u = (pub.pdf_url || '').replace('/files/files/', '/files/')
                              if (!u) return null
                              if (u.startsWith('http')) {
                                return <a className="text-primary underline" href={u} target="_blank" rel="noreferrer">PDF</a>
                              }
                              return <a className="text-primary underline" href={`${API_BASE}${u}`} target="_blank" rel="noreferrer">PDF</a>
                            })()}
                            {/* URL на журнал */}
                            {pub.url && <a className="text-primary underline" href={pub.url} target="_blank" rel="noreferrer">URL (журнал)</a>}
                            {/* DOI дублировать не будем, он есть в соседней колонке */}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {pageItems.map((pub, idx) => (
                  <div key={pub.id} className="rounded-md border bg-white p-3">
                    <div className="text-xs text-gray-500">#{(page-1)*perPage + startIndex + idx} • {pub.year}</div>
                    <div className="mt-1 text-lg font-semibold">{pub.title}</div>
                    <div className="mt-1 whitespace-pre-line text-sm text-gray-600 break-words">
                      {pub.authors.map((a, i) => (
                        <span key={a.id}>
                          <Link className="text-blue-600 hover:underline" href={`/author/${a.id}`}>
                            {a.display_name.replace(/\s*\([^)]*\)\s*/g, '').trim()}
                          </Link>
                          {i < pub.authors.length - 1 ? <><br/></> : null}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 text-sm flex items-center gap-2">
                      <span>Источник: {pub.source?.name ?? '-'}</span>
                      <SourceBadge name={pub.source?.name} type={pub.source?.type ?? undefined} docType={pub.doc_type ?? undefined} uploadSource={pub.upload_source ?? undefined} />
                    </div>
                    <div className="mt-1 text-xs text-gray-600">Язык: {pub.language || '-'}</div>
                    <div className="mt-2 flex gap-4 text-sm flex-wrap">
                      {/* PDF (полная ссылка) */}
                      {(() => {
                        const u = (pub.pdf_url || '').replace('/files/files/', '/files/')
                        if (!u) return null
                        if (u.startsWith('http')) return <a className="text-primary underline" href={u} target="_blank" rel="noreferrer">PDF</a>
                        return <a className="text-primary underline" href={`${API_BASE}${u}`} target="_blank" rel="noreferrer">PDF</a>
                      })()}
                      {pub.url && (<a className="text-primary underline" href={pub.url} target="_blank" rel="noreferrer">URL (журнал)</a>)}
                      {pub.doi && (<a className="text-primary underline" href={`https://doi.org/${pub.doi}`} target="_blank" rel="noreferrer">DOI</a>)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination controls */}
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-gray-600">Страница {page} из {totalPages}. Всего: {items.length}</div>
              <div className="flex items-center gap-2">
                <button className="rounded border px-3 py-1" disabled={page<=1} onClick={()=>setPage(1)}>« Первая</button>
                <button className="rounded border px-3 py-1" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹ Назад</button>
                <button className="rounded border px-3 py-1" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Вперёд ›</button>
                <button className="rounded border px-3 py-1" disabled={page>=totalPages} onClick={()=>setPage(totalPages)}>Последняя »</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
