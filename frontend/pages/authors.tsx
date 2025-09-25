import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { getRole, type Role } from '../lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

type FacetItem = { id: number; name: string; count: number }
type FacultyPeople = { name: string; count: number }
type FacultyPubs = { name: string; people_count: number; publications_count: number }

export default function AuthorsPage() {
  // Make this page public; role may still be used later for extra actions
  const [role, setRole] = useState<Role>('guest')
  useEffect(()=>{ setRole(getRole()) }, [])
  const [q, setQ] = useState('')
  const [items, setItems] = useState<FacetItem[]>([])
  const [facultiesPeople, setFacultiesPeople] = useState<FacultyPeople[]>([])
  const [pubsByName, setPubsByName] = useState<Record<string, { pubs: number; people: number }>>({})
  const [loading, setLoading] = useState(false)

  const debounced = useDebounced(q, 300)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    const sp = new URLSearchParams()
    if (debounced.trim()) sp.set('query', debounced.trim())
    fetch(`${API_BASE}/search/facets/authors?${sp.toString()}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((data: FacetItem[]) => setItems(data))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [debounced])

  // 1) Load people counts immediately (fast)
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${API_BASE}/search/facets/faculties`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((data: FacultyPeople[]) => setFacultiesPeople(data))
      .catch(() => {})
    return () => ctrl.abort()
  }, [])

  // 2) Lazy load publications counts from backend count endpoint (no file download)
  useEffect(() => {
    const abort = new AbortController()
    const fetchCount = async (name: string) => {
      try {
        const scope = /кафедра/iu.test(name) || /кафедрасы/iu.test(name) ? 'department' : 'auto'
        const sp = new URLSearchParams({ faculty: name, match: 'broad' })
        if (scope !== 'auto') sp.set('scope', scope)
        const res = await fetch(`${API_BASE}/search/faculty/count?${sp.toString()}`, { signal: abort.signal })
        const data = await res.json()
        const count = Number(data?.count ?? 0)
        setPubsByName(prev => ({ ...prev, [name]: { pubs: count, people: prev[name]?.people ?? 0 } }))
      } catch {}
    }
    // Trigger after people loaded
    if (facultiesPeople.length) {
      facultiesPeople.forEach(f => fetchCount(f.name))
    }
    return () => abort.abort()
  }, [facultiesPeople])

  const buildExportUrl = (name: string, fmt: 'xlsx'|'csv') => {
    const scope = /кафедра/iu.test(name) || /кафедрасы/iu.test(name) ? 'department' : 'auto'
    const sp = new URLSearchParams({
      faculty: name,
      match: 'broad',
      fmt,
      ...(scope !== 'auto' ? { scope } : {}),
    })
    return `${API_BASE}/search/faculty/export?${sp.toString()}`
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <Head>
        <title>Авторы</title>
      </Head>
      <h1 className="text-2xl font-semibold mb-3">Авторы</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <aside className="md:col-span-1 space-y-2">
          <div className="rounded border bg-white">
            <div className="px-3 py-2 font-semibold border-b">Факультеты</div>
            <ul className="max-h-[60vh] overflow-auto">
              {facultiesPeople.map(f => (
                <li key={f.name} className="px-3 py-2 border-b last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm leading-tight">{f.name}</span>
                    <div className="text-right leading-tight">
                      <div className="text-base text-gray-900 font-semibold">
                        {pubsByName[f.name]?.pubs ?? '∼'}
                      </div>
                      <div className="text-[11px] text-gray-600">Сотрудников: {f.count}</div>
                    </div>
                  </div>
                  <div className="mt-1 flex gap-2">
                    <a className="text-blue-600 text-xs" href={buildExportUrl(f.name, 'xlsx')} target="_blank" rel="noreferrer">Скачать XLSX</a>
                    <a className="text-blue-600 text-xs" href={buildExportUrl(f.name, 'csv')} target="_blank" rel="noreferrer">CSV</a>
                  </div>
                </li>
              ))}
              {!facultiesPeople.length && (
                <li className="px-3 py-2 text-sm text-gray-600">Нет данных</li>
              )}
            </ul>
          </div>
        </aside>
        <section className="md:col-span-2">
          <input
            className="w-full rounded border px-3 py-2 mb-3"
            placeholder="Поиск автора..."
            value={q}
            onChange={(e)=>setQ(e.target.value)}
          />
          {loading && <div>Загрузка…</div>}
          <ul className="divide-y rounded border bg-white">
            {items.map(a => (
              <li key={a.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50">
                <Link className="text-blue-600 hover:underline" href={`/author/${a.id}`}>{a.name}</Link>
                <span className="text-xs text-gray-600">{a.count}</span>
              </li>
            ))}
            {!loading && !items.length && (
              <li className="px-3 py-2 text-sm text-gray-600">Ничего не найдено</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(()=>setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
