import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

type FacetItem = { id: number; name: string; count: number }

export default function AuthorsPage() {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<FacetItem[]>([])
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Head>
        <title>Авторы</title>
      </Head>
      <h1 className="text-2xl font-semibold mb-3">Авторы</h1>
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
