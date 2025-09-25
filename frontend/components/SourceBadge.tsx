type Props = { name?: string | null; type?: string | null; docType?: string | null; uploadSource?: string | null }

function detectBadge({ name, type, docType, uploadSource }: Props): { label: string; color: string; title?: string } {
  const n = (name || '').toLowerCase()
  const t = (type || '').toLowerCase()
  // Articles (new 'article', legacy 'kokson'): show exact docType if available
  const us = (uploadSource || '').toLowerCase()
  if (us === 'kokson' || us === 'article') {
    const dt = (docType || '').trim()
    if (dt) {
      // Shorten well-known long labels but keep full in title attribute
      let short = dt
      const low = dt.toLowerCase()
      if (low.includes('кксон') || low.includes('бғсбк')) short = 'ККСОН'
      return { label: short, color: 'bg-emerald-100 text-emerald-700', title: dt }
    }
    // No explicit docType: generic 'Статья'
    return { label: 'Статья', color: 'bg-emerald-100 text-emerald-700', title: 'Статья' }
  }
  if (t === 'scopus' || n.includes('scopus')) return { label: 'Scopus', color: 'bg-orange-100 text-orange-700' }
  if (t === 'wos' || n.includes('science')) return { label: 'WoS', color: 'bg-blue-100 text-blue-700' }
  if (t === 'thesis' || n.includes('диссер')) return { label: 'Диссертации', color: 'bg-purple-100 text-purple-700' }
  if (!name) return { label: 'Без источника', color: 'bg-gray-100 text-gray-700' }
  return { label: 'Журнал', color: 'bg-gray-100 text-gray-700' }
}

export default function SourceBadge({ name, type, docType, uploadSource }: Props) {
  const b = detectBadge({ name, type, docType, uploadSource })
  const full = b.title || b.label
  const short = full.length > 12 ? (full.slice(0, 12) + '…') : full
  return <span title={full} className={`inline-block rounded px-2 py-0.5 text-xs ${b.color}`}>{short}</span>
}
