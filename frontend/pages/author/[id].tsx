import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

type Author = { id: number; display_name: string }
type UserInfo = { id: number; full_name: string; faculty: string; department: string; position: string; degree: string }

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
}

type AuthorResponse = { author: Author; user?: UserInfo | null; publications: PublicationOut[] }

export default function AuthorPage() {
  const router = useRouter()
  const { id } = router.query
  const [data, setData] = useState<AuthorResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`${API_BASE}/search/authors/${id}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((d: AuthorResponse) => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [id])

  const a = data?.author
  const u = data?.user || null

  return (
    <div className="container mx-auto max-w-4xl px-4 py-6">
      <Head>
        <title>{a ? `Автор: ${a.display_name}` : 'Автор'}</title>
      </Head>
      <div className="mb-4">
        <Link href="/" className="text-blue-600">← На главную</Link>
      </div>
      {loading && <div>Загрузка…</div>}
      {error && <div className="text-red-600">{error}</div>}
      {a && (
        <div className="mb-6 rounded border bg-white p-4">
          <h1 className="mb-2 text-2xl font-semibold">{a.display_name}</h1>
          <div className="mb-3 flex flex-wrap gap-2">
            <a className="rounded border px-3 py-1 text-sm hover:bg-gray-50" href={`${API_BASE}/search/authors/${a.id}/export?fmt=xlsx`} target="_blank" rel="noreferrer">Скачать XLSX</a>
            <a className="rounded border px-3 py-1 text-sm hover:bg-gray-50" href={`${API_BASE}/search/authors/${a.id}/export?fmt=csv`} target="_blank" rel="noreferrer">Скачать CSV</a>
          </div>
          {u ? (
            <div className="text-sm text-gray-700 space-y-1">
              <div><span className="text-gray-500">ФИО (БД):</span> {u.full_name}</div>
              <div><span className="text-gray-500">Факультет:</span> {u.faculty}</div>
              <div><span className="text-gray-500">Кафедра:</span> {u.department}</div>
              <div><span className="text-gray-500">Должность:</span> {u.position}</div>
              <div><span className="text-gray-500">Степень/звание:</span> {u.degree || '-'}</div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">Профиль в БД не найден</div>
          )}
        </div>
      )}

      <h2 className="mb-3 text-xl font-semibold">Публикации</h2>
      <div className="space-y-3">
        {data?.publications?.map(p => (
          <div key={p.id} className="rounded border bg-white p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">{p.year}</div>
              {p.quartile && <div className="text-xs rounded bg-gray-100 px-2 py-0.5">{p.quartile}</div>}
            </div>
            <div className="mt-1 font-medium">{p.title}</div>
            <div className="mt-1 text-sm text-gray-600">
              {p.source?.name} {p.source?.issn ? `(ISSN: ${p.source.issn})` : ''}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {p.doi && <a className="text-blue-600" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer">DOI</a>}
              {p.scopus_url && <a className="text-blue-600" href={p.scopus_url} target="_blank" rel="noreferrer">Scopus</a>}
              {p.pdf_url && <a className="text-blue-600" href={`${API_BASE}${p.pdf_url}`} target="_blank" rel="noreferrer">PDF</a>}
            </div>
          </div>
        ))}
        {!loading && !data?.publications?.length && (
          <div className="text-sm text-gray-500">Публикаций нет</div>
        )}
      </div>
    </div>
  )
}
