import { useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import { useI18n, Lang } from '../lib/i18n'
import FacetMultiSelect from '../components/FacetMultiSelect'
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
  const [quartiles, setQuartiles] = useState<string[]>([])
  const [issn, setIssn] = useState('')
  const [citMin, setCitMin] = useState<number | ''>('')
  const [citMax, setCitMax] = useState<number | ''>('')
  const [pMin, setPMin] = useState<number | ''>('')
  const [pMax, setPMax] = useState<number | ''>('')
  const [authorIds, setAuthorIds] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<StatsResponse | null>(null)
  // refs for chart containers
  const yearlyRef = useRef<HTMLDivElement | null>(null)
  const topAuthorsRef = useRef<HTMLDivElement | null>(null)
  const topSourcesRef = useRef<HTMLDivElement | null>(null)
  const quartilesRef = useRef<HTMLDivElement | null>(null)

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
      filters: { q, yearMin, yearMax, quartiles, issn, citMin, citMax, pMin, pMax, authorIds },
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
  const onDownloadPDF = async () => {
    const imgs: string[] = []
    const a = await svgToPngDataUrl(yearlyRef.current); if (a) imgs.push(a)
    const b = await svgToPngDataUrl(topAuthorsRef.current); if (b) imgs.push(b)
    const c = await svgToPngDataUrl(topSourcesRef.current); if (c) imgs.push(c)
    const d = await svgToPngDataUrl(quartilesRef.current); if (d) imgs.push(d)
    const w = window.open('', '_blank')
    if (!w) return
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Статистика</title>
      <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,'Noto Sans',sans-serif;padding:16px}
      .img{page-break-inside:avoid;margin:0 0 16px 0;max-width:100%}</style></head><body>
      <h2>Статистика — графики</h2>
      ${imgs.map(src=>`<img class="img" src="${src}" />`).join('')}
      <script>window.onload=()=>{setTimeout(()=>window.print(),200)}</script>
    </body></html>`
    w.document.open(); w.document.write(html); w.document.close()
  }

  const toggleQuartile = (qv: string) => {
    setQuartiles(prev => prev.includes(qv) ? prev.filter(x => x !== qv) : [...prev, qv])
  }

  const fetchStats = async () => {
    setLoading(true)
    try {
      const sp = new URLSearchParams()
      if (q.trim()) sp.set('q', q.trim())
      if (yearMin !== '') sp.set('year_min', String(yearMin))
      if (yearMax !== '') sp.set('year_max', String(yearMax))
      quartiles.forEach(qt => sp.append('quartiles', qt))
      if (issn.trim()) sp.set('issn', issn.trim())
      if (citMin !== '') sp.set('citations_min', String(citMin))
      if (citMax !== '') sp.set('citations_max', String(citMax))
      if (pMin !== '') sp.set('percentile_min', String(pMin))
      if (pMax !== '') sp.set('percentile_max', String(pMax))
      authorIds.forEach(id => sp.append('authors', String(id)))
      const res = await fetch(`${API_BASE}/search/stats?${sp.toString()}`)
      const json: StatsResponse = await res.json()
      setData(json)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStats() }, [])

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

        {/* Filters */}
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
          </div>
          <div className="mt-3 flex gap-2">
            <button className="rounded bg-primary px-3 py-1 text-white" type="button" onClick={fetchStats}>{t('search.apply')}</button>
            <button className="rounded border px-3 py-1" type="button" onClick={()=>{ setQ(''); setYearMin(''); setYearMax(''); setQuartiles([]); fetchStats(); }}>{t('search.reset')}</button>
          </div>
        </div>

        {/* Facet: authors */}
        <div className="grid grid-cols-1 gap-3 mb-4">
          <FacetMultiSelect
            title={lang==='kz'?'Авторлар':'Авторы'}
            endpoint="authors"
            params={{ q: q.trim() || undefined, year_min: yearMin || undefined, year_max: yearMax || undefined, issn: issn.trim() || undefined, quartiles }}
            selected={authorIds}
            setSelected={setAuthorIds}
          />
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">{t('stats.kpiPublications')}</div><div className="text-2xl font-bold">{data?.kpi.publications ?? 0}</div></div>
          <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">{t('stats.kpiAuthors')}</div><div className="text-2xl font-bold">{data?.kpi.authors ?? 0}</div></div>
          <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">{t('stats.kpiSources')}</div><div className="text-2xl font-bold">{data?.kpi.sources ?? 0}</div></div>
          <div className="rounded border bg-white p-3"><div className="text-xs text-gray-500">{t('stats.kpiAvg')}</div><div className="text-2xl font-bold">{(data?.kpi.avg_per_author ?? 0).toFixed(2)}</div></div>
        </div>

        {/* Yearly */}
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Top authors */}
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

          {/* Top sources */}
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
        </div>

        {/* Quartiles */}
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
      </div>
    </>
  )
}
