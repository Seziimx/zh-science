import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { useI18n, Lang } from '../lib/i18n'
import { authHeaders, ensureClientId, getToken } from '../lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

type ValidateResp = {
  found: boolean
  source?: { id: number; name: string; type?: string | null; issn?: string | null; sjr_quartile?: string | null }
  message?: string
}

export default function AddPage() {
  const router = useRouter()
  const [lang] = useState<Lang>('ru')
  const t = useI18n(lang)
  // Avoid SSR/client mismatch: initialize as guest/empty and hydrate on client
  const [role, setRole] = useState<'guest'|'user'|'admin'>('guest')
  const [token, setToken] = useState<string>('')
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setRole(((localStorage.getItem('role') as any) || 'guest'))
      setToken(localStorage.getItem('token') || '')
    }
    setMounted(true)
  }, [])

  // Prefill authors from profile for non-admin roles if empty
  useEffect(() => {
    const run = async () => {
      try {
        if (!mounted) return
        if (role === 'admin') return
        if (authors.trim()) return
        const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders() })
        if (!res.ok) return
        const j = await res.json()
        const name = (j?.full_name || '').toString().trim()
        if (name) setAuthors(name)
      } catch {}
    }
    run()
  }, [mounted, role])
  const [uploadSource, setUploadSource] = useState<'scopus'|'article'>('scopus')
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')
  const [year, setYear] = useState<number | ''>('')
  const [sourceName, setSourceName] = useState('')
  const [issn, setIssn] = useState('')
  const [doi, setDoi] = useState('')
  const [scopusLink, setScopusLink] = useState('')
  const [quartile, setQuartile] = useState<string>('')
  const [percentile, setPercentile] = useState<number | ''>('')
  const [file, setFile] = useState<File | null>(null)
  const [citations, setCitations] = useState<number | ''>('')
  const [kokLang, setKokLang] = useState<'ru'|'kz'|'en'|''>('')
  const [kokUrl, setKokUrl] = useState('')
  const [docType, setDocType] = useState('')
  const [publishedDate, setPublishedDate] = useState('') // yyyy-mm-dd
  const [coauthors, setCoauthors] = useState('') // additional authors, semicolon-separated
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
      // Validate authors: each author must contain at least two words with letters
      const authorItems = authors.split(';').map(s=>s.trim()).filter(Boolean)
      if (!authorItems.length) throw new Error('Укажите авторов')
      const letterRe = /[A-Za-z\u0400-\u04FF]/
      const bad = authorItems.find(a => {
        const parts = a.replace(/\s+/g,' ').split(' ')
        // at least two words with length>=2 and containing letters
        if (parts.length < 2) return true
        const firstOk = parts[0].length>=2 && letterRe.test(parts[0])
        const lastOk = parts[1].length>=2 && letterRe.test(parts[1])
        return !(firstOk && lastOk)
      })
      if (bad) throw new Error('Поле "Авторы" должно содержать минимум Имя и Фамилию для каждого автора, разделяя авторов точкой с запятой ;')
      if (uploadSource === 'scopus') {
        // PDF необязателен для Scopus
      } else {
        if (!file) throw new Error(t('add.file'))
      }
      const fd = new FormData()
      fd.set('upload_source', uploadSource)
      fd.set('title', title.trim())
      fd.set('year', String(Number(year)))
      fd.set('authors', authors.trim()) // backend разбирает по ';'
      if (sourceName.trim()) fd.set('source_name', sourceName.trim())
      if (issn.trim()) fd.set('issn', issn.trim())
      if (doi.trim()) fd.set('doi', doi.trim())
      if (uploadSource === 'scopus' && scopusLink.trim()) fd.set('scopus_url', scopusLink.trim())
      if (quartile) fd.set('quartile', quartile)
      if (percentile !== '') fd.set('percentile_2024', String(Number(percentile)))
      fd.set('citations_count', String(citations === '' ? 0 : Number(citations)))
      if (uploadSource === 'article') {
        if (!kokUrl.trim()) throw new Error('Укажите ссылку на журнал/страницу статьи')
        if (!docType.trim()) throw new Error('Выберите тип публикации')
        if (!publishedDate.trim()) throw new Error('Укажите дату публикации')
        if (!kokLang) throw new Error('Выберите язык публикации')
        if (kokLang) fd.set('language', kokLang)
        fd.set('url', kokUrl.trim())
        fd.set('doc_type', docType)
        // send published_date; backend derives year from it
        fd.set('published_date', publishedDate)
      }
      // send coauthors only for Kokson if provided
      if (uploadSource === 'article' && coauthors.trim()) fd.set('coauthors', coauthors.trim())
      if (file) fd.set('file', file)
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
      // Redirect to My Publications with a success banner
      router.push('/mine?submitted=1')
      setTitle(''); setAuthors(''); setYear(''); setSourceName(''); setIssn(''); setDoi(''); setQuartile(''); setPercentile(''); setCitations(''); setFile(null); setKokLang(''); setKokUrl(''); setDocType(''); setPublishedDate(''); setCoauthors(''); setUploadSource('scopus')
      setValidMsg(null)
    } catch (e: any) {
      setDone(`Ошибка: ${e.message || e}`)
    } finally {
      setSubmitting(false)
    }
  }

  // Render a stable placeholder on SSR to prevent hydration errors
  if (!mounted) {
    return (
      <>
        <Head>
          <title>{t('add.title')} — {t('siteTitle')}</title>
        </Head>
        <div className="max-w-3xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold mb-4">{t('add.title')}</h1>
          <div className="rounded border bg-white p-4 text-sm text-gray-600">Загрузка…</div>
        </div>
      </>
    )
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
              Для загрузки требуется роль пользователь или администратор. Выберите роль вверху сайта.
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-600">Источник</label>
            <div className="flex gap-3 text-sm">
              <label className="inline-flex items-center gap-1">
                <input type="radio" name="src" value="scopus" checked={uploadSource==='scopus'} onChange={()=>setUploadSource('scopus')} /> Scopus
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="radio" name="src" value="article" checked={uploadSource==='article'} onChange={()=>setUploadSource('article')} /> Статья
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600">{t('add.name')} <span className="text-red-600">*</span></label>
            <input className="w-full rounded border px-3 py-2" value={title} onChange={e=>setTitle(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm text-gray-600">{t('add.authors')} <span className="text-red-600">*</span></label>
            <input className="w-full rounded border px-3 py-2" value={authors} onChange={e=>setAuthors(e.target.value)} placeholder="Иванов Иван; Smith John" required />
            <div className="text-xs text-gray-500 mt-1">Укажите свою фамилию и имя (например, «Байболатова Гулсезим»). Соавторы — по желанию, через «;».</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600">{t('add.year')} <span className="text-red-600">*</span></label>
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
          {uploadSource==='scopus' && (
            <div>
              <label className="block text-sm text-gray-600">Ссылка на Scopus</label>
              <input className="w-full rounded border px-3 py-2" value={scopusLink} onChange={e=>setScopusLink(e.target.value)} placeholder="https://www.scopus.com/record/display.uri?..." />
              <div className="text-xs text-gray-500 mt-1">Необязательно. Если укажете — ссылка появится в таблицах рядом с DOI.</div>
            </div>
          )}
          {uploadSource==='article' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600">Язык <span className="text-red-600">*</span></label>
                <select className="w-full rounded border px-3 py-2" value={kokLang} onChange={e=>setKokLang(e.target.value as any)}>
                  <option value="">—</option>
                  <option value="ru">Русский</option>
                  <option value="kz">Қазақша</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600">Ссылка на журнал <span className="text-red-600">*</span></label>
                <input className="w-full rounded border px-3 py-2" value={kokUrl} onChange={e=>setKokUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-600">Тип публикации <span className="text-red-600">*</span></label>
                <select className="w-full rounded border px-3 py-2" value={docType} onChange={e=>setDocType(e.target.value)}>
                  <option value="">— выберите тип —</option>
                  <option>БҒСБК(ККСОН) тізіміндегі журнал</option>
                  <option>Ғылыми журнал</option>
                  <option>Әдістемелік нұсқаулар</option>
                  <option>Оқу-әдістемелік құрал</option>
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
                <div className="text-xs text-gray-500 mt-1">Для “Статьи” укажите тип, ссылку и загрузите PDF.</div>
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-600">Соавтор(ы)</label>
                <input
                  className="w-full rounded border px-3 py-2"
                  placeholder="ФИО соавторов через ; (можно оставить пустым)"
                  value={coauthors}
                  onChange={e=>setCoauthors(e.target.value)}
                />
                <div className="text-xs text-gray-500 mt-1">Разделяйте соавторов точкой с запятой ;</div>
              </div>
            </div>
          )}
          {/* Publication date visible for both sources: optional for Scopus, required for Статья */}
          <div>
            <label className="block text-sm text-gray-600">Дата публикации {uploadSource==='article' && (<span className="text-red-600">*</span>)} <span className="text-xs text-gray-500">{uploadSource==='article' ? '(обязательно для Статьи)' : '(необязательно для Scopus)'}</span></label>
            <input
              className="w-full rounded border px-3 py-2"
              placeholder="дд.мм.гггг (например, 02.11.2003)"
              value={publishedDate}
              onChange={e=>setPublishedDate(e.target.value)}
            />
            <div className="text-xs text-gray-500 mt-1">Укажите дату в формате 02.11.2003. Если заполнено, год проставится автоматически.</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {uploadSource !== 'article' && (
              <div>
                <label className="block text-sm text-gray-600">{t('add.citations')}</label>
                <input className="w-full rounded border px-3 py-2" type="number" value={citations} onChange={e=>setCitations(e.target.value?Number(e.target.value):'')} />
                <div className="text-xs text-gray-500 mt-1">При необходимости добавьте DOI вида 10.xxxx/..</div>
              </div>
            )}
            <div>
              <label className="block text-sm text-gray-600">{t('add.file')} {uploadSource==='article' && (<span className="text-red-600">*</span>)}</label>
              <input className="w-full rounded border px-3 py-2" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>setFile(e.target.files?.[0] || null)} />
              <div className="text-xs text-gray-500 mt-1">{t('add.fileHelp')}</div>
              <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 space-y-1">
                <div className="font-semibold">Требования к PDF:</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Обложка журнала (титульная страница).</li>
                  <li>Содержание (оглавление).</li>
                  <li>Статья автора (его часть из журнала).</li>
                </ul>
                <div>Полный журнал (например, 100+ страниц) загружать не нужно. Прикрепляйте мини-версию: обложка + оглавление + ваша статья.</div>
              </div>
            </div>
          </div>
          {uploadSource !== 'article' && (
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
          )}
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
