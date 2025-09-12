import Head from 'next/head'
import { useEffect, useMemo, useState } from 'react'
import { getToken, getRole } from '../lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://127.0.0.1:8000'
    : 'https://zh-science-api.onrender.com')


type Author = { id: number; display_name: string }
type Source = { id: number; name: string | null }

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
  source?: Source | null
  authors: Author[]
  status: string
  note?: string | null
}

// Users list row
type UserRow = {
  id: number
  full_name: string
  login: string
  email?: string | null
  role?: string | null
  faculty: string
  department: string
  position: string
  degree: string
  active: number
  publications_count?: number
}

export default function AdminPage() {
  const [token, setToken] = useState<string>('')
  const [status, setStatus] = useState<'pending'|'approved'|'rejected'|''>('pending')
  const [items, setItems] = useState<Publication[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [roleStr, setRoleStr] = useState<string>('')
  // reject modal
  const [rejectId, setRejectId] = useState<number | null>(null)
  const [rejectNote, setRejectNote] = useState<string>('')

  // users tab state (MVP inline under publications)
  const [users, setUsers] = useState<UserRow[]>([])
  const [uLoading, setULoading] = useState(false)
  const [uError, setUError] = useState<string | null>(null)
  const [uForm, setUForm] = useState({ full_name: '', login: '', role: 'teacher', faculty: '', department: '', position: '', degree: '', password: '' })
  const [uLoginAvail, setULoginAvail] = useState<null|boolean>(null)
  const [matchInfo, setMatchInfo] = useState<{count:number; examples:string[]; publications: Publication[]}>({count:0, examples:[], publications:[]})
  // edit modal
  const [editUserId, setEditUserId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', login: '', role: 'teacher', faculty: '', department: '', position: '', degree: '' })
  const [editLoginAvail, setEditLoginAvail] = useState<null|boolean>(null)
  // password reset modal
  const [pwdUserId, setPwdUserId] = useState<number | null>(null)
  const [pwdValue, setPwdValue] = useState<string>('')
  // publications modal
  const [pubsUserId, setPubsUserId] = useState<number | null>(null)
  const [pubsList, setPubsList] = useState<Publication[]>([])

  // load saved token
  useEffect(() => {
    const saved = getToken()
    if (saved) setToken(saved)
    setRoleStr(getRole())
    setMounted(true)
    const onStorage = () => setToken(getToken())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const headers = useMemo<HeadersInit | undefined>(() => (token ? { 'Authorization': `Bearer ${token}` } : undefined), [token])

  async function fetchList() {
    if (!token) return
    setLoading(true); setError(null)
    try {
      const sp = new URLSearchParams()
      if (status) sp.set('status', status)
      const res = await fetch(`${API_BASE}/admin/publications?${sp.toString()}`, { headers })
      if (!res.ok) throw new Error(await res.text())
      const data: Publication[] = await res.json()
      setItems(data)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchList() }, [token, status])

  // load users list when token available
  useEffect(() => {
    const fetchUsers = async () => {
      if (!token) return
      try {
        setULoading(true); setUError(null)
        const res = await fetch(`${API_BASE}/admin/users`, { headers })
        if (!res.ok) throw new Error(await res.text())
        const list: UserRow[] = await res.json()
        setUsers(list)
      } catch (e:any) {
        setUError(e.message||String(e))
      } finally { setULoading(false) }
    }
    fetchUsers()
  }, [token])

  // live match preview by full name (debounced)
  useEffect(() => {
    const ctrl = new AbortController()
    const h = setTimeout(async () => {
      try {
        const name = uForm.full_name.trim()
        if (!name) { setMatchInfo({count:0, examples:[], publications:[]}); return }
        const sp = new URLSearchParams({ full_name: name, exact: 'true' })
        const res = await fetch(`${API_BASE}/admin/users/match_preview?${sp.toString()}`, { headers: headers ?? {}, signal: ctrl.signal })
        if (!res.ok) return
        const j = await res.json()
        setMatchInfo({ count: j.count||0, examples: j.examples||[], publications: j.publications||[] })
      } catch {}
    }, 400)
    return () => { clearTimeout(h); ctrl.abort() }
  }, [uForm.full_name])

  // check login availability on change
  useEffect(() => {
    const ctrl = new AbortController()
    const run = async () => {
      setULoginAvail(null)
      const v = uForm.login.trim()
      if (!v) return
      try {
        const sp = new URLSearchParams({ login: v })
        const res = await fetch(`${API_BASE}/admin/users/check_login?${sp.toString()}`, { headers: headers ?? {}, signal: ctrl.signal })
        if (!res.ok) return
        const j = await res.json()
        setULoginAvail(Boolean(j.available))
      } catch {}
    }
    run()
    return () => ctrl.abort()
  }, [uForm.login])

  // check login availability for edit modal
  useEffect(() => {
    if (editUserId === null) return
    const ctrl = new AbortController()
    const run = async () => {
      setEditLoginAvail(null)
      const v = editForm.login.trim()
      if (!v) return
      try {
        const sp = new URLSearchParams({ login: v })
        const res = await fetch(`${API_BASE}/admin/users/check_login?${sp.toString()}`, { headers: headers ?? {}, signal: ctrl.signal })
        if (!res.ok) return
        const j = await res.json()
        // если логин совпадает с текущим пользователя — считать допустимым
        const current = users.find(u=>u.id===editUserId)?.login
        setEditLoginAvail(j.available || current === v)
      } catch {}
    }
    run()
    return () => ctrl.abort()
  }, [editForm.login, editUserId])

  function saveToken() { fetchList() }

  async function action(pubId: number, kind: 'approve'|'reject'|'delete') {
    if (!token) return
    const url = kind === 'delete' ? `${API_BASE}/admin/publications/${pubId}` : `${API_BASE}/admin/publications/${pubId}/${kind}`
    if (kind === 'reject') {
      setRejectId(pubId)
      setRejectNote('')
      return
    }
    const opts: RequestInit = { method: kind === 'delete' ? 'DELETE' : 'POST', headers }
    const res = await fetch(url, opts)
    if (!res.ok) { alert(await res.text()); return }
    if (kind === 'approve') {
      setItems(prev => prev.map(p => p.id === pubId ? { ...p, status: 'approved', note: null } : p))
    } else if (kind === 'delete') {
      setItems(prev => prev.filter(p => p.id !== pubId))
    }
  }

  async function submitReject() {
    if (!token || rejectId == null) return
    const res = await fetch(`${API_BASE}/admin/publications/${rejectId}/reject`, {
      method: 'POST',
      headers: { ...(headers||{}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: rejectNote || null })
    })
    if (!res.ok) { alert(await res.text()); return }
    setItems(prev => prev.map(p => p.id === rejectId ? { ...p, status: 'rejected', note: rejectNote || null } : p))
    setRejectId(null); setRejectNote('')
  }

  return (
    <>
      <Head>
        <title>Админ — Science-ARSU</title>
      </Head>
      <div className="max-w-[1200px] mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Админ-панель</h1>

        <div className="rounded border bg-white p-3 mb-3 flex items-center gap-2">
          <div className="text-sm" suppressHydrationWarning>
            Роль: {mounted ? roleStr : ''} {token ? '• авторизован' : '• нет токена'}
          </div>
        {/* Edit user modal */}
        {editUserId !== null && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
            <div className="w-full max-w-lg rounded bg-white p-4 space-y-3">
              <div className="text-lg font-semibold">Изменить пользователя</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500">Логин</label>
                  <input className="w-full rounded border px-2 py-1" value={editForm.login} onChange={e=>setEditForm({...editForm, login: e.target.value})} />
                  {editForm.login && (
                    <div className={`mt-1 text-xs ${editLoginAvail===true?'text-green-700':'text-red-700'}`}>{editLoginAvail===true?'логин свободен':editLoginAvail===false?'логин занят':''}</div>
                  )}
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500">ФИО</label>
                  <input className="w-full rounded border px-2 py-1" value={editForm.full_name} onChange={e=>setEditForm({...editForm, full_name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Роль</label>
                  <select className="w-full rounded border px-2 py-1" value={editForm.role} onChange={e=>setEditForm({...editForm, role: e.target.value})}>
                    <option value="student">студент</option>
                    <option value="teacher">преподаватель</option>
                    <option value="admin">админ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Факультет</label>
                  <input className="w-full rounded border px-2 py-1" value={editForm.faculty} onChange={e=>setEditForm({...editForm, faculty: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Кафедра</label>
                  <input className="w-full rounded border px-2 py-1" value={editForm.department} onChange={e=>setEditForm({...editForm, department: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Должность</label>
                  <input className="w-full rounded border px-2 py-1" value={editForm.position} onChange={e=>setEditForm({...editForm, position: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Учёная степень</label>
                  <input className="w-full rounded border px-2 py-1" value={editForm.degree} onChange={e=>setEditForm({...editForm, degree: e.target.value})} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button className="rounded border px-3 py-1" onClick={()=>{ setEditUserId(null) }}>Отмена</button>
                <button className="rounded bg-primary px-4 py-2 text-white" onClick={async()=>{
                  try {
                    const body: any = { ...editForm }
                    // если логин не менялся — не отправляем поле
                    const current = users.find(u=>u.id===editUserId)
                    if (current && current.login === editForm.login) delete body.login
                    const res = await fetch(`${API_BASE}/admin/users/${editUserId}`, { method:'PATCH', headers:{ ...(headers||{}), 'Content-Type':'application/json' }, body: JSON.stringify(body) })
                    if (!res.ok) throw new Error(await res.text())
                    const upd: UserRow = await res.json()
                    setUsers(prev => prev.map(u => u.id===upd.id ? { ...u, ...upd } : u))
                    setEditUserId(null)
                  } catch (e:any) { alert(e.message||String(e)) }
                }}>Сохранить</button>
              </div>
            </div>
          </div>
        )}

        {/* Reset password modal */}
        {pwdUserId !== null && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
            <div className="w-full max-w-md rounded bg-white p-4 space-y-3">
              <div className="text-lg font-semibold">Сбросить пароль</div>
              <input className="w-full rounded border px-2 py-1" type="password" placeholder="Новый пароль" value={pwdValue} onChange={e=>setPwdValue(e.target.value)} />
              <div className="flex justify-end gap-2">
                <button className="rounded border px-3 py-1" onClick={()=>{ setPwdUserId(null); setPwdValue('') }}>Отмена</button>
                <button className="rounded bg-primary px-4 py-2 text-white" onClick={async()=>{
                  try {
                    const res = await fetch(`${API_BASE}/admin/users/${pwdUserId}/password`, { method:'PATCH', headers:{ ...(headers||{}), 'Content-Type':'application/json' }, body: JSON.stringify({ password: pwdValue }) })
                    if (!res.ok) throw new Error(await res.text())
                    setPwdUserId(null); setPwdValue('')
                  } catch (e:any) { alert(e.message||String(e)) }
                }}>Сохранить</button>
              </div>
            </div>
          </div>
        )}

        {/* User publications modal */}
        {pubsUserId !== null && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
            <div className="w-full max-w-3xl rounded bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">Публикации пользователя #{pubsUserId}</div>
                <button className="rounded border px-3 py-1" onClick={()=>{ setPubsUserId(null); setPubsList([]) }}>Закрыть</button>
              </div>
              <div className="max-h-[60vh] overflow-auto rounded border">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">ID</th>
                      <th className="px-2 py-1 text-left">Год</th>
                      <th className="px-2 py-1 text-left">Статус</th>
                      <th className="px-2 py-1 text-left">Название</th>
                      <th className="px-2 py-1 text-left">Источник</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pubsList.map(p => (
                      <tr key={p.id} className="odd:bg-white even:bg-gray-50">
                        <td className="px-2 py-1">{p.id}</td>
                        <td className="px-2 py-1">{p.year}</td>
                        <td className="px-2 py-1">{p.status}</td>
                        <td className="px-2 py-1 max-w-[400px] break-words">{p.title}</td>
                        <td className="px-2 py-1">{p.source?.name ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
          <button className="rounded bg-primary px-3 py-1 text-white" onClick={saveToken}>Применить</button>
          <select className="ml-auto rounded border px-2 py-1" value={status} onChange={e=>setStatus(e.target.value as any)}>
            <option value="">Все</option>
            <option value="pending">На модерации</option>
            <option value="approved">Одобрено</option>
            <option value="rejected">Отклонено</option>
          </select>
          <button className="rounded border px-3 py-1" onClick={fetchList}>Обновить</button>
        </div>

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

        <div className="rounded border bg-white">
          <table className="min-w-full text-xs table-auto">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">ID</th>
                <th className="px-2 py-1 text-left">Год</th>
                <th className="px-2 py-1 text-left">Статус</th>
                <th className="px-2 py-1 text-left">Название</th>
                <th className="px-2 py-1 text-left">Авторы</th>
                <th className="px-2 py-1 text-left">Источник</th>
                <th className="px-2 py-1 text-left hidden md:table-cell">DOI</th>
                <th className="px-2 py-1 text-left hidden md:table-cell">Scopus</th>
                <th className="px-2 py-1 text-left hidden md:table-cell">Цит.</th>
                <th className="px-2 py-1 text-left hidden lg:table-cell">Квартиль</th>
                <th className="px-2 py-1 text-left hidden lg:table-cell">Perc. 2024</th>
                <th className="px-2 py-1 text-left hidden lg:table-cell">Файл</th>
                <th className="px-2 py-1 text-left">Примечание</th>
                <th className="px-2 py-1 text-left">Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td className="px-2 py-1" colSpan={7}>Загрузка…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td className="px-2 py-1" colSpan={7}>Нет данных</td></tr>
              )}
              {!loading && items.map(p => (
                <tr key={p.id} className="odd:bg-white even:bg-gray-50">
                  <td className="px-2 py-1">{p.id}</td>
                  <td className="px-2 py-1">{p.year}</td>
                  <td className="px-2 py-1">{p.status}</td>
                  <td className="px-2 py-1 max-w-[360px] break-words">{p.title}</td>
                  <td className="px-2 py-1 whitespace-pre-line break-words w-60">{p.authors.map(a=>a.display_name).join('\n')}</td>
                  <td className="px-2 py-1">{p.source?.name ?? '-'}</td>
                  <td className="px-2 py-1 text-blue-700 hidden md:table-cell">{p.doi ? <a className="underline" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer">{p.doi}</a> : '-'}</td>
                  <td className="px-2 py-1 text-blue-700 hidden md:table-cell">{p.scopus_url ? <a className="underline" href={p.scopus_url} target="_blank" rel="noreferrer">Scopus</a> : '-'}</td>
                  <td className="px-2 py-1 hidden md:table-cell">{p.citations_count}</td>
                  <td className="px-2 py-1 hidden lg:table-cell">{p.quartile ?? '-'}</td>
                  <td className="px-2 py-1 hidden lg:table-cell">{p.percentile_2024 ?? '-'}</td>
                  <td className="px-2 py-1 text-blue-700 hidden lg:table-cell">{p.pdf_url ? <a className="underline" href={`${API_BASE}${p.pdf_url}`} target="_blank" rel="noreferrer">Файл</a> : '-'}</td>
                  <td className="px-2 py-1 max-w-[220px] break-words text-gray-700">{p.note ?? '-'}</td>
                  <td className="px-2 py-1">
                    <div className="flex flex-col space-y-1">
                      <span className={
                        `inline-block rounded border px-2 py-0.5 text-[10px] ` +
                        (p.status === 'approved' ? 'bg-green-100 text-green-800 border-green-300' :
                         p.status === 'rejected' ? 'bg-red-100 text-red-800 border-red-300' :
                         'bg-amber-100 text-amber-800 border-amber-300')
                      }>
                        {p.status === 'approved' ? 'Одобрено' : p.status === 'rejected' ? 'Отклонено' : 'На модерации'}
                      </span>
                      <button
                        className="inline-flex items-center gap-1 rounded bg-green-600 px-2 py-1 text-xs text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-1 focus:ring-green-300"
                        onClick={()=>action(p.id,'approve')}
                      >✔ Одобрить</button>
                      <button
                        className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-xs text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-1 focus:ring-red-300"
                        onClick={()=>action(p.id,'reject')}
                      >✖ Отклонить</button>
                      <button
                        className="inline-flex items-center gap-1 rounded bg-gray-700 px-2 py-1 text-xs text-white shadow-sm hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-300"
                        onClick={()=>action(p.id,'delete')}
                      >🗑 Удалить</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rejectId !== null && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
            <div className="w-full max-w-md rounded bg-white p-4 space-y-3">
              <div className="text-lg font-semibold">Причина отклонения</div>
              <textarea className="w-full min-h-[120px] rounded border px-3 py-2" value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="Например: Неверный формат DOI" />
              <div className="flex justify-end gap-2">
                <button className="rounded border px-3 py-1" onClick={()=>{ setRejectId(null); setRejectNote('') }}>Отмена</button>
                <button className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700" onClick={submitReject}>Сохранить</button>
              </div>
            </div>
          </div>
        )}

        {/* Users management */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-3">Пользователи</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded border bg-white p-3">
              <div className="font-medium mb-2">Добавить пользователя</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500">ФИО</label>
                  <input className="w-full rounded border px-2 py-1" value={uForm.full_name} onChange={e=>setUForm({...uForm, full_name:e.target.value})} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500">Логин</label>
                  <input className="w-full rounded border px-2 py-1" value={uForm.login} onChange={e=>setUForm({...uForm, login:e.target.value})} />
                  {uForm.login && (
                    <div className={`mt-1 text-xs ${uLoginAvail===true?'text-green-700':'text-red-700'}`}>{uLoginAvail===true?'логин свободен':uLoginAvail===false?'логин занят':''}</div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Пароль</label>
                  <input className="w-full rounded border px-2 py-1" type="password" value={uForm.password} onChange={e=>setUForm({...uForm, password:e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Роль</label>
                  <select className="w-full rounded border px-2 py-1" value={uForm.role} onChange={e=>setUForm({...uForm, role:e.target.value})}>
                    <option value="student">студент</option>
                    <option value="teacher">преподаватель</option>
                    <option value="admin">админ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Факультет</label>
                  <input className="w-full rounded border px-2 py-1" value={uForm.faculty} onChange={e=>setUForm({...uForm, faculty:e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Кафедра</label>
                  <input className="w-full rounded border px-2 py-1" value={uForm.department} onChange={e=>setUForm({...uForm, department:e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Должность</label>
                  <input className="w-full rounded border px-2 py-1" value={uForm.position} onChange={e=>setUForm({...uForm, position:e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Учёная степень</label>
                  <input className="w-full rounded border px-2 py-1" value={uForm.degree} onChange={e=>setUForm({...uForm, degree:e.target.value})} />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="rounded border px-3 py-1" type="button" onClick={async ()=>{
                  try {
                    if (!uForm.full_name.trim()) return
                    const sp = new URLSearchParams({ full_name: uForm.full_name.trim() })
                    const res = await fetch(`${API_BASE}/admin/users/match_preview?${sp.toString()}`, { headers: headers ?? {} })
                    if (!res.ok) throw new Error(await res.text())
                    const j = await res.json()
                    setMatchInfo({ count: j.count||0, examples: j.examples||[], publications: j.publications||[] })
                  } catch (e:any) {
                    setUError(e.message||String(e))
                  }
                }}>Проверить совпадения</button>
                <button className="rounded bg-primary px-3 py-1 text-white" type="button" onClick={async ()=>{
                  try {
                    setULoading(true); setUError(null)
                    const res = await fetch(`${API_BASE}/admin/users`, {
                      method: 'POST',
                      headers: { ...(headers||{}), 'Content-Type':'application/json' },
                      body: JSON.stringify({ ...uForm })
                    })
                    if (!res.ok) throw new Error(await res.text())
                    const created: UserRow = await res.json()
                    setUsers(prev => [created, ...prev])
                    setUForm({ full_name: '', login: '', role: 'teacher', faculty: '', department: '', position: '', degree: '', password: '' })
                    setMatchInfo({count:0, examples:[], publications:[]})
                  } catch (e:any) {
                    setUError(e.message||String(e))
                  } finally { setULoading(false) }
                }}>Добавить</button>
              </div>
              <div className="mt-2 text-xs text-gray-600">Найдено совпадений: <b>{matchInfo.count}</b> {matchInfo.examples.length?`(${matchInfo.examples.join(', ')})`:''}</div>
              {matchInfo.publications.length>0 && (
                <div className="mt-2 max-h-48 overflow-auto rounded border">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-left">Год</th>
                        <th className="px-2 py-1 text-left">Название</th>
                        <th className="px-2 py-1 text-left">Авторы</th>
                        <th className="px-2 py-1 text-left">Источник</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchInfo.publications.map(p => (
                        <tr key={p.id} className="odd:bg-white even:bg-gray-50">
                          <td className="px-2 py-1">{p.year}</td>
                          <td className="px-2 py-1 max-w-[280px] break-words">{p.title}</td>
                          <td className="px-2 py-1 whitespace-pre-line break-words w-60">{p.authors.map(a=>a.display_name).join('\n')}</td>
                          <td className="px-2 py-1">{p.source?.name ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {uError && <div className="mt-2 text-xs text-red-600">{uError}</div>}
            </div>
            <div className="rounded border bg-white p-3">
              <div className="font-medium mb-2">Список пользователей</div>
              <div className="max-h-72 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">ID</th>
                      <th className="px-2 py-1 text-left">Логин</th>
                      <th className="px-2 py-1 text-left">ФИО</th>
                      <th className="px-2 py-1 text-left">Роль</th>
                      <th className="px-2 py-1 text-left">Должность</th>
                      <th className="px-2 py-1 text-left">Факультет</th>
                      <th className="px-2 py-1 text-left">Кол-во публикаций</th>
                      <th className="px-2 py-1 text-left">Статус</th>
                      <th className="px-2 py-1 text-left">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} className="odd:bg-white even:bg-gray-50">
                        <td className="px-2 py-1">{u.id}</td>
                        <td className="px-2 py-1">{u.login}</td>
                        <td className="px-2 py-1">{u.full_name}</td>
                        <td className="px-2 py-1">{u.role ?? '-'}</td>
                        <td className="px-2 py-1">{u.position}</td>
                        <td className="px-2 py-1">{u.faculty}</td>
                        <td className="px-2 py-1">{u.publications_count ?? 0}</td>
                        <td className="px-2 py-1">{u.active ? 'активен' : 'заблокирован'}</td>
                        <td className="px-2 py-1">
                          <div className="flex flex-col space-y-1">
                            <button className="rounded border px-2 py-0.5 text-xs" onClick={()=>{
                              setEditUserId(u.id)
                              setEditForm({ full_name: u.full_name, login: u.login, role: (u.role||'teacher'), faculty: u.faculty, department: u.department, position: u.position, degree: u.degree })
                              setEditLoginAvail(null)
                            }}>Изменить</button>
                            <button className="rounded border px-2 py-0.5 text-xs" onClick={async()=>{
                              setPubsUserId(u.id)
                              try {
                                const res = await fetch(`${API_BASE}/admin/users/${u.id}/publications`, { headers: headers ?? {} })
                                if (res.ok) setPubsList(await res.json())
                              } catch {}
                            }}>Публикации</button>
                            <button className="rounded border px-2 py-0.5 text-xs" onClick={()=>{ setPwdUserId(u.id); setPwdValue('') }}>Сбросить пароль</button>
                            {u.active ? (
                              <button className="rounded bg-yellow-500 text-white px-2 py-0.5 text-xs" onClick={async()=>{
                                await fetch(`${API_BASE}/admin/users/${u.id}/active`, { method:'PATCH', headers:{ ...(headers||{}), 'Content-Type':'application/json' }, body: JSON.stringify({ active: 0 }) })
                                setUsers(prev => prev.map(x => x.id===u.id? { ...x, active:0 }: x))
                              }}>Заблокировать</button>
                            ) : (
                              <button className="rounded bg-green-600 text-white px-2 py-0.5 text-xs" onClick={async()=>{
                                await fetch(`${API_BASE}/admin/users/${u.id}/active`, { method:'PATCH', headers:{ ...(headers||{}), 'Content-Type':'application/json' }, body: JSON.stringify({ active: 1 }) })
                                setUsers(prev => prev.map(x => x.id===u.id? { ...x, active:1 }: x))
                              }}>Разблокировать</button>
                            )}
                            <button className="rounded bg-red-600 text-white px-2 py-0.5 text-xs" onClick={async()=>{
                              if (!confirm('Удалить пользователя?')) return
                              const res = await fetch(`${API_BASE}/admin/users/${u.id}`, { method:'DELETE', headers: headers||{} })
                              if (res.ok) setUsers(prev => prev.filter(x=>x.id!==u.id))
                            }}>Удалить</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
