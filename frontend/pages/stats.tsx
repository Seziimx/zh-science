import { useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import { useI18n, Lang } from '../lib/i18n'
import { authHeaders } from '../lib/auth'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
  LabelList,
} from 'recharts'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

type YearItem = { year: number; publications: number; citations: number }

type StatsResponse = {
  kpi: { publications: number; authors: number; sources: number; avg_per_author: number }
  yearly: YearItem[]
  top_authors: { author: string; count: number }[]
  top_sources: { source: string; count: number }[]
  quartiles: { quartile: string; count: number }[]
}

// Articles stats types
type FacultyRow = { faculty: string; count: number }
type DeptRow = { department: string; count: number }
type LangShareRow = { year: number; total: number; ru: number; kz: number; en: number; ru_pct: number; kz_pct: number; en_pct: number }

export default function StatsPage() {
  const [lang, setLang] = useState<Lang>('ru')
  const t = useI18n(lang)
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? (localStorage.getItem('lang') as Lang | null) : null
    if (saved === 'ru' || saved === 'kz') setLang(saved)
  }, [])

  // filters
  const [q, setQ] = useState('')
  const [yearMin, setYearMin] = useState<number | ''>('')
  const [yearMax, setYearMax] = useState<number | ''>('')
  const [issn, setIssn] = useState('')
  const [citMin, setCitMin] = useState<number | ''>('')
  const [citMax, setCitMax] = useState<number | ''>('')
  // percentile and authors filtering removed for simplicity on this page
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<StatsResponse | null>(null)
  // Articles (Статьи) stats state
  const [docType, setDocType] = useState<string>('')
  const [yearSel, setYearSel] = useState<number | ''>('')
  const [facSummary, setFacSummary] = useState<FacultyRow[] | null>(null)
  const [selectedFaculty, setSelectedFaculty] = useState<string | null>(null)
  const [deptRows, setDeptRows] = useState<DeptRow[] | null>(null)
  const [langShare, setLangShare] = useState<LangShareRow[] | null>(null)
  const [aLoading, setALoading] = useState(false)
  const [printMode, setPrintMode] = useState(false)
  type DataSource = 'all' | 'scopus' | 'articles'
  const [dataSource, setDataSource] = useState<DataSource>('all')
  // Doc types list stays for Articles filter below
  const topDocTypes = [
    'БҒСБК(ККСОН) тізіміндегі журнал',
    'Ғылыми журнал',
    'Әдістемелік нұсқаулар',
    'Оқу-әдістемелік құрал',
    'Танымдық жинақ',
    'Энциклопедия',
    'Монография',
    'Шығармалар жинағы',
    'Аймақтық',
    'Халықаралық',
    'Шетелдік',
    'Международный',
    'Республикалық',
    'Авторлық куәлік',
    'Патент',
    'Конференциялар жинағы',
    'Кітаптар',
  ] as const
  // Top selector removed per request
  // Latest year derived from language_share (when year input is empty)
  const [derivedYear, setDerivedYear] = useState<number | null>(null)

  // Helper: trim trailing "факультет/факультеті" to keep labels short
  function trimFaculty(name: string): string {
    const s = (name || '').trim()
    const lower = s.toLowerCase()
    const suf = [' факультеті', ' факультет']
    for (const x of suf) {
      if (lower.endsWith(x)) return s.slice(0, s.length - x.length)
    }
    return s
  }
  
  // Wait until a container has an <svg> child or timeout
  async function waitForSvg(container: HTMLDivElement | null, timeoutMs = 2000, intervalMs = 100): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (container && container.querySelector('svg')) return true
      await delay(intervalMs)
    }
    return !!(container && container.querySelector('svg'))
  }
  // refs for chart containers
  const yearlyRef = useRef<HTMLDivElement | null>(null)
  const topAuthorsRef = useRef<HTMLDivElement | null>(null)
  const topSourcesRef = useRef<HTMLDivElement | null>(null)
  const quartilesRef = useRef<HTMLDivElement | null>(null)
  // Articles (Статьи) chart refs
  const facRef = useRef<HTMLDivElement | null>(null)
  const deptRef = useRef<HTMLDivElement | null>(null)
  const langRef = useRef<HTMLDivElement | null>(null)

  // download helpers
  function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function toCSV(rows: any[], headers: string[]): string {
    const esc = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const head = headers.join(',')
    const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n')
    return head + '\n' + body
  }

  const onDownload = () => {
    if (!data) return
    const payload = {
      filters: { q, yearMin, yearMax, issn, citMin, citMax },
      stats: data,
      generatedAt: new Date().toISOString(),
    }
    downloadText('stats.json', JSON.stringify(payload, null, 2))
  }

  const onDownloadCSV = () => {
    if (!data) return
    // export yearly as CSV
    const csv = toCSV(data.yearly, ['year','publications','citations'])
    downloadText('stats_yearly.csv', csv)
  }

  // helper: save a single SVG (inside container) as PNG
  function downloadSvgAsPng(container: HTMLDivElement | null, filename: string) {
    if (!container) return
    const svg = container.querySelector('svg') as SVGSVGElement | null
    if (!svg) return
    const serializer = new XMLSerializer()
    const svgStr = serializer.serializeToString(svg)
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => {
        if (!blob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(()=>URL.revokeObjectURL(a.href), 1000)
      }, 'image/png')
    }
    img.src = url
  }

  // build data URL (PNG) from chart SVG inside a container
  function svgToPngDataUrl(container: HTMLDivElement | null): Promise<string | null> {
    return new Promise((resolve) => {
      if (!container) return resolve(null)
      const svg = container.querySelector('svg') as SVGSVGElement | null
      if (!svg) return resolve(null)
      const serializer = new XMLSerializer()
      const svgStr = serializer.serializeToString(svg)
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        URL.revokeObjectURL(url)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = url
    })
  }

  // Open a printable window with all charts as images; user can Save as PDF
  const delay = (ms:number)=>new Promise(res=>setTimeout(res,ms))
  const onDownloadPDF = async () => {
    // Always include ALL charts in the PDF: temporarily switch to 'all', fetch data, wait, capture, then restore
    const prev = dataSource
    if (prev !== 'all') {
      setDataSource('all')
    }
    // Ensure data is loaded for both Scopus and Articles blocks
    await Promise.allSettled([
      fetchStats(),
      fetchArticlesStats(),
    ])
    // Wait for charts/data to render (ensure SVGs present) — always do this, even if we were already on 'all'
    await Promise.all([
      waitForSvg(yearlyRef.current),
      waitForSvg(topAuthorsRef.current),
      waitForSvg(topSourcesRef.current),
      waitForSvg(quartilesRef.current),
      waitForSvg(facRef.current),
      waitForSvg(deptRef.current),
      waitForSvg(langRef.current),
    ])
    // Enable print mode (shows labels inside bars) and allow charts to settle
    setPrintMode(true)
    await delay(500)
    const items: { src: string; cap: string }[] = []
    const push = (src: string | null, cap: string) => { if (src) items.push({ src, cap }) }
    // Scopus charts
    push(await svgToPngDataUrl(yearlyRef.current), 'Scopus — годы: публикации и цитирования')
    push(await svgToPngDataUrl(topAuthorsRef.current), 'Scopus — топ авторов (по количеству публикаций)')
    push(await svgToPngDataUrl(topSourcesRef.current), 'Scopus — топ источников (по количеству публикаций)')
    push(await svgToPngDataUrl(quartilesRef.current), 'Scopus — распределение по квартилям')
    // Articles charts
    push(await svgToPngDataUrl(facRef.current), 'Статьи (ККСОН) — по факультетам')
    push(await svgToPngDataUrl(deptRef.current), 'Статьи (ККСОН) — по кафедрам')
    push(await svgToPngDataUrl(langRef.current), 'Статьи (ККСОН) — доли языков по годам (%)')
    const w = window.open('', '_blank')
    if (!w) return
    const htmlImgs = items.map(it=>`<img class="img" src="${it.src}" /><div class="cap">${it.cap}</div>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Статистика</title>
      <style>
        html,body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,'Noto Sans',sans-serif;padding:16px;color:#111}
        .img{page-break-inside:avoid;margin:0 4px 6px 0;max-width:100%;display:block}
        .cap{font-size:12px;color:#444;margin:0 0 16px 0}
        @media print{ *{-webkit-print-color-adjust:exact; print-color-adjust:exact} }
      </style></head><body>
      <h2>Статистика — графики</h2>
      ${htmlImgs}
      <div class=\"cap\">Обозначения цветов: Қазақша — синий, Русский — зелёный, English — оранжевый.</div>
      <script>window.onload=()=>{setTimeout(()=>window.print(),200)}</script>
    </body></html>`
    w.document.open(); w.document.write(html); w.document.close()
    // Disable print mode back
    setTimeout(()=>setPrintMode(false), 0)
    // Restore previous data source if changed
    if (prev !== 'all') setTimeout(()=>setDataSource(prev), 0)
  }

  // quartile toggle removed

  const fetchStats = async () => {
    setLoading(true)
    try {
      const sp = new URLSearchParams()
      if (q.trim()) sp.set('q', q.trim())
      if (yearMin !== '') sp.set('year_min', String(yearMin))
      if (yearMax !== '') sp.set('year_max', String(yearMax))
      if (issn.trim()) sp.set('issn', issn.trim())
      if (citMin !== '') sp.set('citations_min', String(citMin))
      if (citMax !== '') sp.set('citations_max', String(citMax))
      // Filter by upload source according to selector
      if (dataSource === 'scopus') sp.set('upload_source', 'scopus')
      if (dataSource === 'articles') sp.set('upload_source', 'kokson')
      // percentiles and authors filters removed
      const res = await fetch(`${API_BASE}/search/stats?${sp.toString()}`)
      const json: StatsResponse = await res.json()
      setData(json)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStats() }, [dataSource])

  // Fetch Articles (Статьи) stats
  const fetchArticlesStats = async () => {
    try {
      setALoading(true)
      // Build params for current year/doc_type
      const spFac = new URLSearchParams()
      if (yearSel !== '') spFac.set('year', String(yearSel))
      if (docType) spFac.set('doc_type', docType)
      const spLang = new URLSearchParams()
      if (yearSel !== '') { spLang.set('year_min', String(yearSel)); spLang.set('year_max', String(yearSel)) }
      if (docType) spLang.set('doc_type', docType)

      // Fetch both in parallel
      const [facRes, langRes] = await Promise.all([
        fetch(`${API_BASE}/publications/stats/articles/faculty_summary?${spFac.toString()}`),
        fetch(`${API_BASE}/publications/stats/language_share?${spLang.toString()}`),
      ])
      let facArr = facRes.ok ? await facRes.json() : []
      let lshareArr = langRes.ok ? await langRes.json() : []
      // Fallback to Kokson-only endpoint if general endpoint returns empty
      if ((!Array.isArray(lshareArr) || lshareArr.length === 0)) {
        try {
          const oldRes = await fetch(`${API_BASE}/publications/stats/articles/language_share?${spLang.toString()}`)
          if (oldRes.ok) lshareArr = await oldRes.json()
        } catch {}
      }

      // If faculty empty and no year selected, try derive latest year from language_share and refetch faculty_summary
      if ((!Array.isArray(facArr) || !facArr.length) && yearSel === '' && Array.isArray(lshareArr) && lshareArr.length) {
        const latest = Math.max(...lshareArr.map((r:any)=>Number(r.year)||0))
        if (latest > 0) {
          setDerivedYear(latest)
          const spF = new URLSearchParams(); spF.set('year', String(latest)); if (docType) spF.set('doc_type', docType)
          const facRes2 = await fetch(`${API_BASE}/publications/stats/articles/faculty_summary?${spF.toString()}`)
          facArr = facRes2.ok ? await facRes2.json() : []
        }
      } else {
        setDerivedYear(null)
      }

      // Fallback: if still empty, retry without doc_type
      if ((!Array.isArray(facArr) || !facArr.length) && docType) {
        try {
          const spF2 = new URLSearchParams(); if (yearSel !== '') spF2.set('year', String(yearSel))
          const facRes3 = await fetch(`${API_BASE}/publications/stats/articles/faculty_summary?${spF2.toString()}`)
          const tmp = facRes3.ok ? await facRes3.json() : []
          if (Array.isArray(tmp) && tmp.length) facArr = tmp
        } catch {}
      }
      // Ultimate fallback: no year, no doc_type
      if ((!Array.isArray(facArr) || !facArr.length) && yearSel === '' && docType) {
        try {
          const facRes4 = await fetch(`${API_BASE}/publications/stats/articles/faculty_summary`)
          const tmp = facRes4.ok ? await facRes4.json() : []
          if (Array.isArray(tmp) && tmp.length) facArr = tmp
        } catch {}
      }

      setFacSummary(Array.isArray(facArr) ? facArr : [])
      setLangShare(Array.isArray(lshareArr) ? lshareArr : [])
      // reset drilldown when filters changed
      setSelectedFaculty(null)
      setDeptRows(null)
    } finally {
      setALoading(false)
    }
  }

  useEffect(() => { fetchArticlesStats() }, [docType, yearSel])
  useEffect(() => { fetchArticlesStats() }, [])

  const onFacultyClick = async (faculty: string) => {
    try {
      setALoading(true)
      setSelectedFaculty(faculty)
      // If year input is empty, try using derived latest year from stats
      let y = yearSel === '' ? (derivedYear ?? null) : Number(yearSel)
      if (!y) {
        // Fallback: compute latest year from language_share now
        try {
          const res = await fetch(`${API_BASE}/publications/stats/articles/language_share`, { headers: authHeaders() })
          const arr = await res.json()
          if (Array.isArray(arr) && arr.length) {
            const latest = Math.max(...arr.map((r:any)=>Number(r.year)||0))
            if (latest > 0) {
              y = latest
              setDerivedYear(latest)
            }
          }
        } catch {}
      }
      if (!y) { setDeptRows([]); return }
      const sp = new URLSearchParams()
      sp.set('year', String(y))
      sp.set('faculty', faculty)
      if (docType) sp.set('doc_type', docType)
      const res = await fetch(`${API_BASE}/publications/stats/articles/faculty_breakdown?${sp.toString()}`, { headers: authHeaders() })
      const json: any = await res.json()
      setDeptRows(Array.isArray(json) ? json as DeptRow[] : [])
    } finally {
      setALoading(false)
    }
  }

  const maxYearPub = useMemo(() => Math.max(1, ...(data?.yearly.map(y => y.publications) ?? [1])), [data])
  const maxAuth = useMemo(() => Math.max(1, ...(data?.top_authors.map(a => a.count) ?? [1])), [data])
  const maxSrc = useMemo(() => Math.max(1, ...(data?.top_sources.map(s => s.count) ?? [1])), [data])
  const maxQuart = useMemo(() => Math.max(1, ...(data?.quartiles.map(q => q.count) ?? [1])), [data])

  return (
    <>
      <Head>
        <title>{t('stats.title')} — {t('siteTitle')}</title>
      </Head>
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t('stats.title')}</h1>
          <div className="flex items-center gap-2">
            <button className="rounded bg-primary px-3 py-1 text-white" type="button" onClick={onDownloadPDF}>{t('stats.downloadPdf')}</button>
            <button className="rounded border px-3 py-1" type="button" onClick={()=>downloadSvgAsPng(yearlyRef.current!, 'yearly.png')}>{t('stats.pngYears')}</button>
            <button className="rounded border px-3 py-1" type="button" onClick={()=>downloadSvgAsPng(topAuthorsRef.current!, 'top_authors.png')}>{t('stats.pngAuthors')}</button>
            <button className="rounded border px-3 py-1" type="button" onClick={()=>downloadSvgAsPng(topSourcesRef.current!, 'top_sources.png')}>{t('stats.pngSources')}</button>
            <button className="rounded border px-3 py-1" type="button" onClick={()=>downloadSvgAsPng(quartilesRef.current!, 'quartiles.png')}>{t('stats.pngQuartiles')}</button>
          </div>
        </div>

        {/* Articles (Статьи) filters */}
        <div className="rounded border bg-white p-3 mb-4">
          <div className="mb-2 font-semibold">Статьи — сводка по факультетам</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
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
            <div>
              <label className="block text-xs text-gray-500">Год</label>
              <input className="w-full rounded border px-2 py-1" type="number" value={yearSel} onChange={e=>setYearSel(e.target.value?Number(e.target.value):'')} />
            </div>
            <div className="col-span-2 flex items-end gap-2">
              <button className="rounded bg-primary px-3 py-1 text-white disabled:opacity-50" disabled={aLoading} onClick={fetchArticlesStats}>Обновить</button>
            </div>
          </div>
          {/* Faculty summary (Articles) */}
          {(dataSource==='all' || dataSource==='articles') && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div ref={facRef} className="rounded border p-3">
              <div className="mb-2 font-medium">По факультетам</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(facSummary||[]).map(r=>({ faculty: r.faculty, facultyDisplay: trimFaculty(r.faculty), count: r.count }))} margin={{ top: 10, right: 20, left: 20, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="facultyDisplay" angle={-25} textAnchor="end" interval={0} height={60} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#0047AB" name="Количество" onClick={(d:any)=>onFacultyClick(d.faculty)} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-xs text-gray-600">Кликните по столбцу, чтобы увидеть разбивку по кафедрам</div>
            </div>
            <div className="rounded border p-3">
              <div className="mb-2 font-medium">Разбивка по кафедрам{selectedFaculty?` — ${selectedFaculty}`:''}</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(deptRows||[])} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="department" type="category" width={190} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#00A676" name="Количество" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          )}
          {(dataSource==='all' || dataSource==='articles') && (
          <div className="mt-3 rounded border p-3">
            <div className="mb-2 font-medium">Доли языков по годам (%)</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={langShare||[]} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis domain={[0,100]} tickFormatter={(v)=>`${v}%`} />
                  <Tooltip formatter={(v:any)=>`${v}%`} />
                  <Legend />
                  <Bar dataKey="kz_pct" stackId="lang" name="Қазақша %" fill="#1e88e5">
                    {printMode && (
                      <LabelList dataKey="kz_pct" position="center" formatter={(v:any)=>`${v}%`} style={{ fill:'#fff', fontSize:10 }} />
                    )}
                  </Bar>
                  <Bar dataKey="ru_pct" stackId="lang" name="Русский %" fill="#43a047">
                    {printMode && (
                      <LabelList dataKey="ru_pct" position="center" formatter={(v:any)=>`${v}%`} style={{ fill:'#fff', fontSize:10 }} />
                    )}
                  </Bar>
                  <Bar dataKey="en_pct" stackId="lang" name="English %" fill="#f4511e">
                    {printMode && (
                      <LabelList dataKey="en_pct" position="center" formatter={(v:any)=>`${v}%`} style={{ fill:'#fff', fontSize:10 }} />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          )}
        </div>

        {/* Filters */}
        {(dataSource==='all' || dataSource==='scopus') && (
        <div ref={yearlyRef} className="rounded border bg-white p-3 mb-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <input
                className="w-full rounded border px-3 py-2"
                placeholder={t('search.placeholder')}
                value={q}
                onChange={(e)=>setQ(e.target.value)}
              />
            </div>
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
            {/* Quartile filter removed on this page */}
            <div>
              <label className="block text-xs text-gray-500">{t('search.citFrom')}</label>
              <input className="w-full rounded border px-2 py-1" type="number" value={citMin} onChange={e=>setCitMin(e.target.value?Number(e.target.value):'')} />
            </div>
            <div>
              <label className="block text-xs text-gray-500">{t('search.citTo')}</label>
              <input className="w-full rounded border px-2 py-1" type="number" value={citMax} onChange={e=>setCitMax(e.target.value?Number(e.target.value):'')} />
            </div>
            {/* Percentile filters removed */}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="rounded bg-primary px-3 py-1 text-white" type="button" onClick={fetchStats}>{t('search.apply')}</button>
            <button className="rounded border px-3 py-1" type="button" onClick={()=>{ setQ(''); setYearMin(''); setYearMax(''); fetchStats(); }}>{t('search.reset')}</button>
          </div>
        </div>
        )}
        {(dataSource==='all' || dataSource==='articles') && (
        <div className="rounded border bg-white p-3 mb-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500">Тип публикации</label>
              <select className="w-full rounded border px-2 py-1" value={docType} onChange={e=>setDocType(e.target.value)}>
                <option value="">Все</option>
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
            </div>
            <div>
              <label className="block text-xs text-gray-500">Год</label>
              <input className="w-full rounded border px-2 py-1" type="number" value={yearSel} onChange={e=>setYearSel(e.target.value?Number(e.target.value):'')} />
            </div>
            <div className="col-span-2 flex items-end gap-2">
              <button className="rounded bg-primary px-3 py-1 text-white disabled:opacity-50" disabled={aLoading} onClick={fetchArticlesStats}>Обновить</button>
            </div>
          </div>
        </div>
        )}
        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">{t('stats.kpiPublications')}</div><div className="text-2xl font-bold">{data?.kpi.publications ?? 0}</div></div>
          <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">{t('stats.kpiAuthors')}</div><div className="text-2xl font-bold">{data?.kpi.authors ?? 0}</div></div>
          <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">{t('stats.kpiSources')}</div><div className="text-2xl font-bold">{data?.kpi.sources ?? 0}</div></div>
          <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">{t('stats.kpiAvg')}</div><div className="text-2xl font-bold">{(data?.kpi.avg_per_author ?? 0).toFixed(2)}</div></div>
        </div>

        {/* Yearly */}
        {(dataSource==='all' || dataSource==='scopus') && (
        <div className="rounded border bg-white p-3 mb-4">
          <div className="mb-2 font-semibold">{t('stats.yearly')}</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.yearly || []} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="publications" stroke="#0047AB" name={t('stats.kpiPublications')} />
                <Line type="monotone" dataKey="citations" stroke="#8884d8" name={t('search.citations')} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        )}
        {(dataSource==='all' || dataSource==='articles') && (
        <div className="rounded border bg-white p-3 mb-4">
          <div className="mb-2 font-semibold">Статьи (ККСОН) — по факультетам</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(facSummary||[]).map(r=>({ faculty: r.faculty, count: r.count }))} margin={{ top: 10, right: 20, left: 20, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="faculty" angle={-25} textAnchor="end" interval={0} height={60} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#0047AB" name="Количество" onClick={(d:any)=>onFacultyClick(d.faculty)} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Top authors */}
          {(dataSource==='all' || dataSource==='scopus') && (
          <div ref={topAuthorsRef} className="rounded border bg-white p-3">
            <div className="mb-2 font-semibold">{t('stats.topAuthors')}</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.top_authors || []} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="author" type="category" width={150} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0047AB" name={t('stats.kpiPublications')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          )}
          {/* Top sources (Scopus) */}
          {(dataSource==='all' || dataSource==='scopus') && (
          <div className="rounded border bg-white p-3">
            <div className="mb-2 font-semibold">{t('stats.topSources')}</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.top_sources || []} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="source" type="category" width={150} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#00A676" name={t('stats.kpiPublications')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          )}
        </div>

        {/* Quartiles */}
        {(dataSource==='all' || dataSource==='scopus') && (
        <div ref={quartilesRef} className="rounded border bg-white p-3 mt-3">
          <div className="mb-2 font-semibold">{t('stats.quartiles')}</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.quartiles || []} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="quartile" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        )}
      </div>
    </>
  )
}
