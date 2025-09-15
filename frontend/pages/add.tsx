import Head from 'next/head'
import { useState } from 'react'
import { useI18n, Lang } from '../lib/i18n'
import { authHeaders, ensureClientId, getToken } from '../lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

type ValidateResp = {
  found: boolean
  source?: { id: number; name: string; type?: string | null; issn?: string | null; sjr_quartile?: string | null }
  message?: string
}

export default function AddPage() {
  const [lang] = useState<Lang>('ru')
  const t = useI18n(lang)
  const [role] = useState<'guest'|'user'|'admin'>(() => (typeof window!=='undefined' && (localStorage.getItem('role') as any)) || 'guest')
  const [token] = useState<string>(() => (typeof window!=='undefined' && (localStorage.getItem('token')||'')) || '')
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')
  const [year, setYear] = useState<number | ''>('')
  const [sourceName, setSourceName] = useState('')
  const [issn, setIssn] = useState('')
  const [doi, setDoi] = useState('')
  const [quartile, setQuartile] = useState<string>('')
  const [percentile, setPercentile] = useState<number | ''>('')
  const [file, setFile] = useState<File | null>(null)
  const [citations, setCitations] = useState<number | ''>('')
  const [validMsg, setValidMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const validateSource = async () => {
    setValidMsg(t('add.checking'))
    const params = new URLSearchParams()
    if (issn.trim()) params.set('issn', issn.trim())
    else if (sourceName.trim()) params.set('name', sourceName.trim())
    const res = await fetch(`${API_BASE}/publications/validate/source?${params.toString()}`, {
      headers: authHeaders(),
    })
    const json: ValidateResp = await res.json()
    if (json.found && json.source) {
      setValidMsg(`Найден источник: ${json.source.name}${json.source.sjr_quartile ? ' • ' + json.source.sjr_quartile : ''}`)
    } else {
      setValidMsg('Источник не найден — можно добавить вручную')
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setDone(null)
    try {
      if (!file) throw new Error(t('add.file'))
      const fd = new FormData()
      fd.set('title', title.trim())
      fd.set('year', String(Number(year)))
      fd.set('authors', authors.trim()) // backend разбирает по ';'
      if (sourceName.trim()) fd.set('source_name', sourceName.trim())
      if (issn.trim()) fd.set('issn', issn.trim())
      if (doi.trim()) fd.set('doi', doi.trim())
      if (quartile) fd.set('quartile', quartile)
      if (percentile !== '') fd.set('percentile_2024', String(Number(percentile)))
      fd.set('citations_count', String(citations === '' ? 0 : Number(citations)))
      fd.set('file', file)
      // ensure client id exists
      ensureClientId()
      const res = await fetch(`${API_BASE}/publications/upload`, {
        method: 'POST',
        body: fd,
        headers: authHeaders(),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt)
      }
      setDone(t('add.submitted'))
      setTitle(''); setAuthors(''); setYear(''); setSourceName(''); setIssn(''); setDoi(''); setQuartile(''); setPercentile(''); setCitations(''); setFile(null)
      setValidMsg(null)
    } catch (e: any) {
      setDone(`Ошибка: ${e.message || e}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Head>
        <title>{t('add.title')} — {t('siteTitle')}</title>
      </Head>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">{t('add.title')}</h1>
        <form onSubmit={onSubmit} className="rounded border bg-white p-4 space-y-3">
          {role==='guest' && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
              Для загрузки требуется роль пользователь или администратор. Выберите роль вверху сайта и введите пароль (user: 123, admin: 1234).
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-600">{t('add.name')}</label>
            <input className="w-full rounded border px-3 py-2" value={title} onChange={e=>setTitle(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm text-gray-600">{t('add.authors')}</label>
            <input className="w-full rounded border px-3 py-2" value={authors} onChange={e=>setAuthors(e.target.value)} placeholder="И. Иванов; B. Researcher" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600">{t('add.year')}</label>
              <input className="w-full rounded border px-3 py-2" type="number" value={year} onChange={e=>setYear(e.target.value?Number(e.target.value):'')} required />
            </div>
            <div>
              <label className="block text-sm text-gray-600">{t('add.doi')}</label>
              <input className="w-full rounded border px-3 py-2" value={doi} onChange={e=>setDoi(e.target.value)} placeholder="10.xxxx/...." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600">{t('add.source')}</label>
              <input className="w-full rounded border px-3 py-2" value={sourceName} onChange={e=>setSourceName(e.target.value)} placeholder="Название журнала" />
            </div>
            <div>
              <label className="block text-sm text-gray-600">{t('add.issn')}</label>
              <input className="w-full rounded border px-3 py-2" value={issn} onChange={e=>setIssn(e.target.value)} placeholder="1234-5678" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600">{t('add.citations')}</label>
              <input className="w-full rounded border px-3 py-2" type="number" value={citations} onChange={e=>setCitations(e.target.value?Number(e.target.value):'')} />
            </div>
            <div>
              <label className="block text-sm text-gray-600">{t('add.file')}</label>
              <input className="w-full rounded border px-3 py-2" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>setFile(e.target.files?.[0] || null)} />
              <div className="text-xs text-gray-500 mt-1">{t('add.fileHelp')}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600">{t('add.quartile')}</label>
              <select className="w-full rounded border px-3 py-2" value={quartile} onChange={e=>setQuartile(e.target.value)}>
                <option value="">—</option>
                <option value="Q1">Q1</option>
                <option value="Q2">Q2</option>
                <option value="Q3">Q3</option>
                <option value="Q4">Q4</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600">{t('add.percentile')}</label>
              <input className="w-full rounded border px-3 py-2" type="number" value={percentile} onChange={e=>setPercentile(e.target.value?Number(e.target.value):'')} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="rounded border px-3 py-1" type="button" onClick={validateSource}>{t('add.checkSource')}</button>
            {validMsg && <div className="text-sm text-gray-700">{validMsg}</div>}
          </div>
          <div>
            <button disabled={submitting || role==='guest'} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-50" type="submit">
              {submitting ? 'Отправка…' : t('add.save')}
            </button>
            {done && <div className="mt-2 text-sm">{done}</div>}
          </div>
        </form>
      </div>
    </>
  )
}
