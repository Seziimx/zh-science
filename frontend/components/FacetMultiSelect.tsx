import { useEffect, useMemo, useState } from 'react'
import { useI18n, useLang } from '../lib/i18n'

// Use env if set; fallback to local for development
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

type FacetItem = { id: number; name: string; count: number }

type Props = {
  title: string
  endpoint: 'authors' | 'sources'
  // current search filter params to include in facets request
  params: Record<string, string | number | (string | number)[] | undefined>
  selected: number[]
  setSelected: (ids: number[]) => void
}

export default function FacetMultiSelect({ title, endpoint, params, selected, setSelected }: Props) {
  const [items, setItems] = useState<FacetItem[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [lang] = useLang()
  const t = useI18n(lang)
  const [mounted, setMounted] = useState(false)

  const qs = useMemo(() => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === '' || v === null) return
      if (Array.isArray(v)) v.forEach(val => sp.append(k, String(val)))
      else sp.set(k, String(v))
    })
    if (q.trim()) sp.set('query', q.trim())
    return sp.toString()
  }, [params, q])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    fetch(`${API_BASE}/search/facets/${endpoint}?${qs}`)
      .then(r => r.json())
      .then((data: FacetItem[]) => { if (active) setItems(data) })
      .catch((e) => { if (active) { setItems([]); setError('api_unreachable') } })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [endpoint, qs])

  useEffect(() => { setMounted(true) }, [])

  const toggle = (id: number) => {
    setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  return (
    <div className="rounded border bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">{title}</div>
        <div className="text-xs text-gray-500" suppressHydrationWarning>
          {mounted ? `${t('facet.selected')} ${selected.length}` : ''}
        </div>
      </div>
      {error === 'api_unreachable' && (
        <div className="mb-2 rounded bg-yellow-50 px-2 py-1 text-xs text-yellow-700">
          API недоступен. Проверьте, запущен ли сервер на {API_BASE}.
        </div>
      )}
      <input
        className="mb-2 w-full rounded border px-2 py-1"
        placeholder={mounted ? (loading ? t('facet.loading') : t('facet.search')) : ''}
        value={q}
        onChange={(e)=>setQ(e.target.value)}
      />
      <div className="max-h-64 overflow-auto pr-1">
        {items.map(it => (
          <label key={it.id} className="flex cursor-pointer items-center justify-between rounded px-2 py-1 hover:bg-gray-50">
            <span className="flex items-center gap-2">
              <input type="checkbox" className="accent-primary" checked={selected.includes(it.id)} onChange={()=>toggle(it.id)} />
              <span>{it.name}</span>
            </span>
            <span className="text-xs text-gray-500">{it.count}</span>
          </label>
        ))}
        {!items.length && !loading && (
          <div className="text-sm text-gray-500" suppressHydrationWarning>{mounted ? t('facet.empty') : ''}</div>
        )}
      </div>
    </div>
  )
}
