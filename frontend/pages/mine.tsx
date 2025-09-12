import Head from 'next/head'
import { useEffect, useMemo, useState } from 'react'
import { authHeaders } from '../lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://127.0.0.1:8000'
    : 'https://zh-science-api.onrender.com')


type AuthorOut = { id: number; display_name: string }
type SourceOut = { id: number; name: string | null; type?: string | null }

type Publication = {
  id: number
  year: number
  title: string
  doi?: string | null
  scopus_url?: string | null
  pdf_url?: string | null
  citations_count: number
  quartile?: string | null
  percentile_2024?: number | null
  source?: SourceOut | null
  authors: AuthorOut[]
  status: 'pending' | 'approved' | 'rejected'
  note?: string | null
}

function StatusBadge({ status }: { status: Publication['status'] | string }) {
  const map: Record<'pending' | 'approved' | 'rejected', { text: string; cls: string }> = {
    pending: { text: 'На модерации', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    approved: { text: 'Одобрено', cls: 'bg-green-100 text-green-800 border-green-300' },
    rejected: { text: 'Отклонено', cls: 'bg-red-100 text-red-800 border-red-300' },
  }
  const v = (map as any)[status] ?? { text: String(status ?? ''), cls: 'bg-gray-100 text-gray-700 border-gray-300' }
  return <span className={`text-xs rounded border px-2 py-0.5 ${v.cls}`}>{v.text}</span>
}

export default function MyPublicationsPage() {
  const [items, setItems] = useState<Publication[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<number | null>(null)

  // edit modal state
  const [editId, setEditId] = useState<number | null>(null)
  const editItem = useMemo(() => items.find(i => i.id === editId) || null, [items, editId])
  const [title, setTitle] = useState('')
  const [year, setYear] = useState<number | ''>('')
  const [doi, setDoi] = useState('')
  const [citations, setCitations] = useState<number | ''>('')
  const [quartile, setQuartile] = useState('')
  const [percentile, setPercentile] = useState<number | ''>('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/publications/mine`, { headers: authHeaders() })
      if (!res.ok) throw new Error(await res.text())
      const data: Publication[] = await res.json()
      setItems(data)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openEdit(p: Publication) {
    setEditId(p.id)
    setTitle(p.title)
    setYear(p.year)
    setDoi(p.doi || '')
    setCitations(p.citations_count)
    setQuartile(p.quartile || '')
    setPercentile(p.percentile_2024 ?? '')
    setFile(null)
    setSaveErr(null)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editItem) return
    setSaving(true); setSaveErr(null)
    try {
      const fd = new FormData()
      if (title.trim() !== editItem.title) fd.set('title', title.trim())
      if (year !== '' && year !== editItem.year) fd.set('year', String(year))
      if ((doi || '') !== (editItem.doi || '')) fd.set('doi', doi)
      if (citations !== '' && citations !== editItem.citations_count) fd.set('citations_count', String(citations))
      if ((quartile || '') !== (editItem.quartile || '')) fd.set('quartile', quartile)
      if (percentile !== '' && percentile !== (editItem.percentile_2024 ?? '')) fd.set('percentile_2024', String(percentile))
      if (file) fd.set('file', file)
      const res = await fetch(`${API_BASE}/publications/mine/${editItem.id}`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      })
      if (!res.ok) throw new Error(await res.text())
      const updated: Publication = await res.json()
      setItems(prev => prev.map(it => it.id === updated.id ? updated : it))
      setEditId(null)
      setToast('Сохранено')
      setHighlightId(updated.id)
      setTimeout(()=>setToast(null), 2000)
      setTimeout(()=>setHighlightId(null), 2500)
    } catch (e: any) {
      setSaveErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Head>
        <title>Мои публикации — Science-ARSU</title>
      </Head>
      <div className="max-w-[1200px] mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Мои публикации</h1>

        {toast && (
          <div className="mb-3 rounded bg-green-100 border border-green-300 text-green-800 px-3 py-2 inline-block">{toast}</div>
        )}

        {error && <div className="mb-3 text-sm text-red-700">{error}</div>}

        <div className="rounded border bg-white">
          <table className="min-w-full text-sm table-auto">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Год</th>
                <th className="px-3 py-2 text-left">Статус</th>
                <th className="px-3 py-2 text-left">Название</th>
                <th className="px-3 py-2 text-left">Авторы</th>
                <th className="px-3 py-2 text-left">Источник</th>
                <th className="px-3 py-2 text-left">DOI</th>
                <th className="px-3 py-2 text-left">Scopus</th>
                <th className="px-3 py-2 text-left">Цит.</th>
                <th className="px-3 py-2 text-left">Квартиль</th>
                <th className="px-3 py-2 text-left">Perc. 2024</th>
                <th className="px-3 py-2 text-left">Файл</th>
                <th className="px-3 py-2 text-left">Примечание</th>
                <th className="px-3 py-2 text-left">Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td className="px-3 py-2" colSpan={7}>Загрузка…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td className="px-3 py-2" colSpan={7}>Нет данных</td></tr>
              )}
              {!loading && items.map(p => (
                <tr key={p.id} className={`odd:bg-white even:bg-gray-50 ${highlightId===p.id ? 'animate-pulse bg-green-50' : ''}`}>
                  <td className="px-3 py-2">{p.id}</td>
                  <td className="px-3 py-2">{p.year}</td>
                  <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                  <td className="px-3 py-2 max-w-[420px] break-words">{p.title}</td>
                  <td className="px-3 py-2 whitespace-pre-line break-words w-64">{p.authors.map(a=>a.display_name).join('\n')}</td>
                  <td className="px-3 py-2">{p.source?.name ?? '-'}</td>
                  <td className="px-3 py-2 text-blue-700">{p.doi ? <a className="underline" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer">{p.doi}</a> : '-'}</td>
                  <td className="px-3 py-2 text-blue-700">{p.scopus_url ? <a className="underline" href={p.scopus_url} target="_blank" rel="noreferrer">Scopus</a> : '-'}</td>
                  <td className="px-3 py-2">{p.citations_count}</td>
                  <td className="px-3 py-2">{p.quartile ?? '-'}</td>
                  <td className="px-3 py-2">{p.percentile_2024 ?? '-'}</td>
                  <td className="px-3 py-2 text-blue-700">{p.pdf_url ? <a className="underline" href={p.pdf_url} target="_blank" rel="noreferrer">Файл</a> : '-'}</td>
                  <td className="px-3 py-2 max-w-[260px] break-words text-gray-700">{p.note ?? '-'}</td>
                  <td className="px-3 py-2 space-x-2">
                    {(p.status === 'pending' || p.status === 'rejected') && (
                      <button className="rounded border px-2 py-0.5" onClick={()=>openEdit(p)}>Изменить</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editItem && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <form onSubmit={saveEdit} className="w-full max-w-lg rounded bg-white p-4 space-y-3">
              <div className="text-lg font-semibold">Редактировать публикацию #{editItem.id}</div>
              <div>
                <label className="block text-sm text-gray-600">Название</label>
                <input className="w-full rounded border px-3 py-2" value={title} onChange={e=>setTitle(e.target.value)} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600">Год</label>
                  <input className="w-full rounded border px-3 py-2" type="number" value={year} onChange={e=>setYear(e.target.value?Number(e.target.value):'')} required />
                </div>
                <div>
                  <label className="block text-sm text-gray-600">DOI</label>
                  <input className="w-full rounded border px-3 py-2" value={doi} onChange={e=>setDoi(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600">Цитирования</label>
                  <input className="w-full rounded border px-3 py-2" type="number" value={citations} onChange={e=>setCitations(e.target.value?Number(e.target.value):'')} />
                </div>
                <div>
                  <label className="block text-sm text-gray-600">Заменить файл (PDF/Word)</label>
                  <input className="w-full rounded border px-3 py-2" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>setFile(e.target.files?.[0] || null)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600">Квартиль</label>
                  <select className="w-full rounded border px-3 py-2" value={quartile} onChange={e=>setQuartile(e.target.value)}>
                    <option value="">—</option>
                    <option value="Q1">Q1</option>
                    <option value="Q2">Q2</option>
                    <option value="Q3">Q3</option>
                    <option value="Q4">Q4</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600">Перцентиль 2024</label>
                  <input className="w-full rounded border px-3 py-2" type="number" value={percentile} onChange={e=>setPercentile(e.target.value?Number(e.target.value):'')} />
                </div>
              </div>
              {saveErr && <div className="text-sm text-red-700">{saveErr}</div>}
              <div className="flex gap-2 justify-end">
                <button className="rounded border px-3 py-1" type="button" onClick={()=>setEditId(null)}>Отмена</button>
                <button disabled={saving} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-50" type="submit">Сохранить</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </>
  )
}
