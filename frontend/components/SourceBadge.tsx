type Props = { name?: string | null; type?: string | null }

function detectBadge({ name, type }: Props): { label: string; color: string } {
  const n = (name || '').toLowerCase()
  const t = (type || '').toLowerCase()
  if (t === 'scopus' || n.includes('scopus')) return { label: 'Scopus', color: 'bg-orange-100 text-orange-700' }
  if (t === 'wos' || n.includes('science')) return { label: 'WoS', color: 'bg-blue-100 text-blue-700' }
  if (t.includes('кокс') || n.includes('коксон') || t === 'koks' || t === 'koksоn') return { label: 'КОКСОН', color: 'bg-emerald-100 text-emerald-700' }
  if (t === 'thesis' || n.includes('диссер')) return { label: 'Диссертации', color: 'bg-purple-100 text-purple-700' }
  if (!name) return { label: 'Без источника', color: 'bg-gray-100 text-gray-700' }
  return { label: 'Журнал', color: 'bg-gray-100 text-gray-700' }
}

export default function SourceBadge({ name, type }: Props) {
  const b = detectBadge({ name, type })
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${b.color}`}>{b.label}</span>
}
