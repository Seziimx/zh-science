import Head from 'next/head'
import { useEffect, useMemo, useState } from 'react'
import { getToken, getRole } from '../lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

type Source = { id: number; name: string | null }

type Publication = {
  id: number
  year: number
  title: string
  source?: Source | null
  status: string
}

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

export default function UsersPage() {
  const [token, setToken] = useState<string>('')
  const [roleStr, setRoleStr] = useState<string>('')
  const [mounted, setMounted] = useState(false)

  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<'table'|'cards'>('table')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'name_asc'|'name_desc'>('name_asc')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [totalCount, setTotalCount] = useState<number>(0)
  const [showPwd, setShowPwd] = useState<Record<number, boolean>>({})
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ full_name: '', login: '', email: '', role: 'teacher', faculty: '', department: '', position: '', degree: '', password: '' })
  const [addLoginAvail, setAddLoginAvail] = useState<null|boolean>(null)
  const [addTouched, setAddTouched] = useState<{full_name?:boolean;login?:boolean;password?:boolean}>({})
  const [loginManuallyEdited, setLoginManuallyEdited] = useState(false)
  const [facOptions, setFacOptions] = useState<string[]>([])
  const [depAll, setDepAll] = useState<string[]>([])
  const [depOptions, setDepOptions] = useState<string[]>([])
  const [deptMap, setDeptMap] = useState<Record<string,string>>({})

  // Auto-generate login from full name if login has not been manually edited
  function genLoginFromName(name: string): string {
    const s = (name || '').replace(/\u00A0/g, ' ').trim().toLowerCase()
    const only = s.replace(/[^a-zа-яё0-9 ]/gi, '').replace(/\s+/g, '')
    return only
  }
  useEffect(() => {
    if (!loginManuallyEdited) {
      setAddForm(prev => ({ ...prev, login: genLoginFromName(prev.full_name) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addForm.full_name])

  // Load faculties/departments options when opening add modal
  useEffect(() => {
    if (!addOpen) return
    const ctrl = new AbortController()
    ;(async ()=>{
      try {
        const res = await fetch(`${API_BASE}/publications/facdep`, { signal: ctrl.signal })
        if (res.ok) {
          const j = await res.json()
          const facs = Array.isArray(j.faculties) ? j.faculties : []
          const deps = Array.isArray(j.departments) ? j.departments : []
          const mp = (j.map && typeof j.map === 'object') ? j.map as Record<string,string> : {}
          setFacOptions(facs)
          setDepAll(deps)
          setDeptMap(mp)
          setDepOptions(addForm.faculty ? deps.filter((d: string) => mp[d] === addForm.faculty) : deps)
        } else {
          setFacOptions([]); setDepAll([]); setDeptMap({}); setDepOptions([])
        }
      } catch {}
    })()
    return () => ctrl.abort()
  }, [addOpen])

  // Refilter departments when faculty changes
  useEffect(() => {
    if (!addOpen) return
    const fac = addForm.faculty
    if (!fac) { setDepOptions(depAll); return }
    setDepOptions(depAll.filter((d: string) => deptMap[d] === fac))
  }, [addForm.faculty, addOpen, depAll, deptMap])

  // Debounced login availability check for Add modal
  useEffect(() => {
    const ctrl = new AbortController()
    const v = (addForm.login||'').trim()
    if (!v) { setAddLoginAvail(null); return }
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({ login: v })
        const h: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {}
        const res = await fetch(`${API_BASE}/admin/users/check_login?${sp.toString()}`, { headers: h, signal: ctrl.signal })
        if (res.ok) {
          const j = await res.json()
          setAddLoginAvail(j.available === true)
        } else {
          setAddLoginAvail(null)
        }
      } catch { setAddLoginAvail(null) }
    }, 350)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [addForm.login, token])

  const addInvalid = useMemo(() => {
    const nameOk = addForm.full_name.trim().length >= 3
    const pwOk = addForm.password.trim().length >= 6
    const loginOk = addForm.login.trim().length >= 3 && (addLoginAvail !== false)
    return !(nameOk && pwOk && loginOk)
  }, [addForm.full_name, addForm.password, addForm.login, addLoginAvail])

  // modals
  const [editUserId, setEditUserId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', login: '', role: 'teacher', faculty: '', department: '', position: '', degree: '' })
  const [editLoginAvail, setEditLoginAvail] = useState<null|boolean>(null)
  const [pwdUserId, setPwdUserId] = useState<number | null>(null)
  const [pwdValue, setPwdValue] = useState<string>('')
  const [pubsUserId, setPubsUserId] = useState<number | null>(null)
  const [pubsList, setPubsList] = useState<Publication[]>([])

  // token/role
  useEffect(() => {
    const t = getToken()
    if (t) setToken(t)
    setRoleStr(getRole())
    setMounted(true)
  }, [])

  const headers = useMemo<HeadersInit | undefined>(() => (token ? { 'Authorization': `Bearer ${token}` } : undefined), [token])

  async function fetchUsers() {
    setLoading(true); setError(null)
    try {
      // Prefer admin endpoint for admins; if missing token or 401, fallback to public
      if (roleStr === 'admin') {
        if (token) {
          const sp = new URLSearchParams()
          if (q.trim()) sp.set('q', q.trim())
          sp.set('page', String(page))
          sp.set('per_page', String(perPage))
          const res = await fetch(`${API_BASE}/admin/users?${sp.toString()}`, { headers })
          if (res.ok) {
            const list: UserRow[] = await res.json()
            setUsers(list)
            const x = res.headers.get('X-Total-Count')
            setTotalCount(x ? Number(x) : list.length)
            return
          }
        }
        // fallback to public list with client-side filters
        const sp = new URLSearchParams()
        if (q.trim()) sp.set('q', q.trim())
        sp.set('order', sort === 'name_desc' ? 'name_desc' : 'name_asc')
        const res2 = await fetch(`${API_BASE}/public/users?${sp.toString()}`)
        if (!res2.ok) throw new Error(await res2.text())
        const list2: UserRow[] = await res2.json()
        setUsers(list2)
        setTotalCount(list2.length)
        setError('Нет токена администратора — показан публичный список. Выберите роль admin и введите пароль.')
        return
      } else {
        const sp = new URLSearchParams()
        if (q.trim()) sp.set('q', q.trim())
        sp.set('order', sort === 'name_desc' ? 'name_desc' : 'name_asc')
        const res = await fetch(`${API_BASE}/public/users?${sp.toString()}`)
        if (!res.ok) throw new Error(await res.text())
        const list: UserRow[] = await res.json()
        setUsers(list)
        setTotalCount(list.length)
      }
    } catch (e:any) {
      setError(e.message||String(e))
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchUsers() }, [token, roleStr, page, perPage, q, sort])

  // edit login availability check
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
        const current = users.find(u=>u.id===editUserId)?.login
        setEditLoginAvail(j.available || current === v)
      } catch {}
    }
    run()
    return () => ctrl.abort()
  }, [editForm.login, editUserId])

  const filtered = useMemo(() => {
    // when data comes from /public/users it's already filtered/sorted; keep local filter for /admin/users
    const raw = q || ''
    const term = raw.replace(/\u00A0/g, ' ').trim().toLowerCase()
    // Normalizer: remove spaces and common punctuation for robust match
    const norm = (s: string) => (s||'').replace(/\u00A0/g,' ').replace(/[.,;]+/g,'').replace(/\s+/g,'').toLowerCase()
    const tokens = term.split(/\s+/).filter(Boolean)
    let arr = users
    // For admin we rely on server-side pagination/filtering; don't refilter/sort here
    return arr
  }, [users, q, sort, roleStr])

  const totalPages = Math.max(1, Math.ceil((roleStr==='admin' ? totalCount : filtered.length) / perPage))
  const pageItems = useMemo(() => {
    // For admin, users already corresponds to current page
    return roleStr==='admin' ? users : filtered.slice((page - 1) * perPage, (page - 1) * perPage + perPage)
  }, [users, filtered, page, perPage, roleStr])

  useEffect(()=>{ if (page>totalPages) setPage(totalPages) }, [totalPages])

  if (mounted && roleStr !== 'admin') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Head><title>Пользователи — доступ только для админов</title></Head>
        <h1 className="text-2xl font-bold mb-2">Пользователи</h1>
        <p className="text-sm text-gray-700">Эта страница доступна только администраторам. Выберите роль admin вверху сайта и введите пароль.</p>
      </div>
    )
  }

  return (
    <>
      <Head><title>Пользователи — Science-ARSU</title></Head>
      <div className="max-w-[1200px] mx-auto px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <h1 className="text-2xl font-bold">Пользователи</h1>
          <span className="ml-3 text-xs rounded border px-2 py-0.5 text-gray-700 bg-gray-50">Источник: {roleStr==='admin' && token ? 'admin' : 'public'} · {users.length}</span>
          <div className="ml-auto flex items-center gap-2">
            <input className="rounded border px-3 py-1" placeholder="Поиск (ФИО/логин)" value={q} onChange={e=>setQ(e.target.value)} />
            <select className="rounded border px-2 py-1" value={sort} onChange={e=>setSort(e.target.value as any)}>
              <option value="name_asc">Имя A–Я</option>
              <option value="name_desc">Имя Я–A</option>
            </select>
            <div className="rounded border p-0.5">
              <button className={`px-2 py-1 text-sm ${view==='table'?'bg-primary text-white rounded':''}`} onClick={()=>setView('table')}>Таблица</button>
              <button className={`px-2 py-1 text-sm ${view==='cards'?'bg-primary text-white rounded':''}`} onClick={()=>setView('cards')}>Карточки</button>
            </div>
            <button className="rounded border px-3 py-1" onClick={fetchUsers}>Обновить</button>
            {roleStr==='admin' && (
              <>
                <button disabled={!token} className={`rounded px-3 py-1 ${token? 'bg-primary text-white':'bg-gray-300 text-gray-600 cursor-not-allowed'}`} onClick={()=>{ if (!token) return; setAddOpen(true); setAddForm({ full_name:'', login:'', email:'', role:'teacher', faculty:'', department:'', position:'', degree:'', password:'' }) }}>Добавить пользователя</button>
                <button disabled={!token} className={`rounded border px-3 py-1 ${token? '':'opacity-50 cursor-not-allowed'}`} onClick={async()=>{
                  try {
                    if (!token) { return }
                    const res = await fetch(`${API_BASE}/admin/users/export?fmt=xlsx`, { headers: headers })
                    if (!res.ok) { alert(await res.text()); return }
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a'); a.href = url; a.download = 'users.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 1000)
                  } catch (e:any) { alert(e.message||String(e)) }
                }}>Экспорт XLSX</button>
              </>
            )}

      {addOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="w-full max-w-lg rounded bg-white p-4 space-y-3">
            <div className="text-lg font-semibold">Добавить пользователя</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500">ФИО</label>
                <input className="w-full rounded border px-2 py-1" value={addForm.full_name} onChange={e=>{ setAddForm({...addForm, full_name: e.target.value}); setAddTouched(t=>({...t, full_name:true})) }} />
                {addTouched.full_name && addForm.full_name.trim().length < 3 && (
                  <div className="mt-1 text-xs text-red-700">минимум 3 символа</div>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500">Логин (опц.)</label>
                <input className="w-full rounded border px-2 py-1" value={addForm.login} onChange={e=>{ setAddForm({...addForm, login: e.target.value}); setLoginManuallyEdited(true); setAddTouched(t=>({...t, login:true})) }} />
                {addForm.login && (
                  <div className={`mt-1 text-xs ${addLoginAvail===true?'text-green-700':addLoginAvail===false?'text-red-700':'text-gray-500'}`}>
                    {addLoginAvail===true?'логин свободен':addLoginAvail===false?'логин занят':'проверка…'}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500">Email (опц.)</label>
                <input className="w-full rounded border px-2 py-1" value={addForm.email} onChange={e=>setAddForm({...addForm, email: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs text-gray-500">Роль</label>
                <select className="w-full rounded border px-2 py-1" value={addForm.role} onChange={e=>setAddForm({...addForm, role: e.target.value})}>
                  <option value="student">студент</option>
                  <option value="teacher">преподаватель</option>
                  <option value="admin">админ</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500">Пароль</label>
                <input className="w-full rounded border px-2 py-1" type="password" value={addForm.password} onChange={e=>{ setAddForm({...addForm, password: e.target.value}); setAddTouched(t=>({...t, password:true})) }} />
                {addTouched.password && addForm.password.trim().length < 6 && (
                  <div className="mt-1 text-xs text-red-700">минимум 6 символов</div>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500">Факультет</label>
                <select className="w-full rounded border px-2 py-1" value={addForm.faculty} onChange={e=>setAddForm({...addForm, faculty: e.target.value})}>
                  <option value="">— выберите —</option>
                  {facOptions.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500">Кафедра</label>
                <select className="w-full rounded border px-2 py-1" value={addForm.department} onChange={e=>setAddForm({...addForm, department: e.target.value})}>
                  <option value="">— выберите —</option>
                  {depOptions.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500">Должность</label>
                <input className="w-full rounded border px-2 py-1" value={addForm.position} onChange={e=>setAddForm({...addForm, position: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs text-gray-500">Учёная степень</label>
                <input className="w-full rounded border px-2 py-1" value={addForm.degree} onChange={e=>setAddForm({...addForm, degree: e.target.value})} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="rounded border px-3 py-1" onClick={()=>setAddOpen(false)}>Отмена</button>
              <button disabled={addInvalid} className={`rounded px-4 py-2 text-white ${addInvalid?'bg-gray-400 cursor-not-allowed':'bg-primary'}`} onClick={async()=>{
                try {
                  if (!token) { alert('Нет токена администратора'); return }
                  const body:any = { ...addForm }
                  if (!body.login) delete body.login
                  if (!body.email) delete body.email
                  const res = await fetch(`${API_BASE}/admin/users`, { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(body) })
                  if (!res.ok) throw new Error(await res.text())
                  const u: UserRow = await res.json()
                  setUsers(prev => [u, ...prev])
                  setAddOpen(false)
                  setLoginManuallyEdited(false); setAddTouched({}); setAddLoginAvail(null)
                } catch (e:any) { alert(e.message||String(e)) }
              }}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">На странице</label>
              <select className="rounded border px-2 py-1" value={perPage} onChange={e=>{ setPerPage(Number(e.target.value)); setPage(1) }}>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
        </div>

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

        {loading ? (
          <div>Загрузка…</div>
        ) : (
          <>
            {view === 'table' ? (
              <div className="rounded border bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">ID</th>
                      <th className="px-2 py-1 text-left">Логин</th>
                      <th className="px-2 py-1 text-left">ФИО</th>
                      <th className="px-2 py-1 text-left">Роль</th>
                      <th className="px-2 py-1 text-left">Должность</th>
                      <th className="px-2 py-1 text-left">Факультет</th>
                      <th className="px-2 py-1 text-left">Публикаций</th>
                      <th className="px-2 py-1 text-left">Статус</th>
                      {roleStr==='admin' && (<th className="px-2 py-1 text-left">Действия</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map(u => (
                      <tr key={u.id} className="odd:bg-white even:bg-gray-50">
                        <td className="px-2 py-1">{u.id}</td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-2">
                            <span>{u.login}</span>
                            {roleStr==='admin' && (
                              <>
                                <span className="text-gray-400">|</span>
                                <span className="text-xs text-gray-700">
                                  Начальный пароль: {showPwd[u.id] ? (u as any).initial_password || '-' : '••••••'}
                                </span>
                                <button className="text-blue-700 text-xs underline" onClick={()=>setShowPwd(prev=>({ ...prev, [u.id]: !prev[u.id] }))}>
                                  {showPwd[u.id] ? 'Скрыть' : 'Показать'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1">{u.full_name}</td>
                        <td className="px-2 py-1">{u.role ?? '-'}</td>
                        <td className="px-2 py-1">{u.position}</td>
                        <td className="px-2 py-1">{u.faculty}</td>
                        <td className="px-2 py-1">{u.publications_count ?? 0}</td>
                        <td className="px-2 py-1">{u.active ? 'активен' : 'заблокирован'}</td>
                        {roleStr==='admin' && (
                        <td className="px-2 py-1">
                          <div className="flex flex-col space-y-1">
                            <button className="rounded border px-2 py-0.5 text-xs" onClick={()=>{ setEditUserId(u.id); setEditForm({ full_name: u.full_name, login: u.login, role: (u.role||'teacher'), faculty: u.faculty, department: u.department, position: u.position, degree: u.degree }); setEditLoginAvail(null) }}>Изменить</button>
                            <button className="rounded border px-2 py-0.5 text-xs" onClick={async()=>{ setPubsUserId(u.id); try { const res = await fetch(`${API_BASE}/admin/users/${u.id}/publications?match=initials`, { headers: headers ?? {} }); if (res.ok) setPubsList(await res.json()) } catch {} }}>Публикации</button>
                            <button className="rounded border px-2 py-0.5 text-xs" onClick={()=>{ setPwdUserId(u.id); setPwdValue('') }}>Сбросить пароль</button>
                            {u.active ? (
                              <button className="rounded bg-yellow-500 text-white px-2 py-0.5 text-xs" onClick={async()=>{ await fetch(`${API_BASE}/admin/users/${u.id}/active`, { method:'PATCH', headers:{ ...(headers||{}), 'Content-Type':'application/json' }, body: JSON.stringify({ active: 0 }) }); setUsers(prev => prev.map(x => x.id===u.id? { ...x, active:0 }: x)) }}>Заблокировать</button>
                            ) : (
                              <button className="rounded bg-green-600 text-white px-2 py-0.5 text-xs" onClick={async()=>{ await fetch(`${API_BASE}/admin/users/${u.id}/active`, { method:'PATCH', headers:{ ...(headers||{}), 'Content-Type':'application/json' }, body: JSON.stringify({ active: 1 }) }); setUsers(prev => prev.map(x => x.id===u.id? { ...x, active:1 }: x)) }}>Разблокировать</button>
                            )}
                            <button className="rounded bg-red-600 text-white px-2 py-0.5 text-xs" onClick={async()=>{ if (!confirm('Удалить пользователя?')) return; const res = await fetch(`${API_BASE}/admin/users/${u.id}`, { method:'DELETE', headers: headers||{} }); if (res.ok) setUsers(prev => prev.filter(x=>x.id!==u.id)) }}>Удалить</button>
                          </div>
                        </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {pageItems.map(u => (
                  <div key={u.id} className="rounded border bg-white p-3">
                    <div className="text-sm text-gray-500">#{u.id}</div>
                    <div className="text-lg font-medium">{u.full_name}</div>
                    <div className="text-sm">Логин: <b>{u.login}</b></div>
                    {roleStr==='admin' && (
                      <div className="text-xs text-gray-700">
                        Начальный пароль: {showPwd[u.id] ? (u as any).initial_password || '-' : '••••••'}
                        <button className="ml-2 text-blue-700 underline" onClick={()=>setShowPwd(prev=>({ ...prev, [u.id]: !prev[u.id] }))}>
                          {showPwd[u.id] ? 'Скрыть' : 'Показать'}
                        </button>
                      </div>
                    )}
                    <div className="text-sm">Роль: {u.role ?? '-'}</div>
                    <div className="text-sm">Должность: {u.position}</div>
                    <div className="text-sm">Факультет: {u.faculty}</div>
                    <div className="text-sm">Публикаций: {u.publications_count ?? 0}</div>
                    <div className="text-sm">Статус: {u.active ? 'активен' : 'заблокирован'}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="rounded border px-2 py-0.5 text-xs" onClick={()=>{ setEditUserId(u.id); setEditForm({ full_name: u.full_name, login: u.login, role: (u.role||'teacher'), faculty: u.faculty, department: u.department, position: u.position, degree: u.degree }); setEditLoginAvail(null) }}>Изменить</button>
                      <button className="rounded border px-2 py-0.5 text-xs" onClick={async()=>{ setPubsUserId(u.id); try { const res = await fetch(`${API_BASE}/admin/users/${u.id}/publications?match=initials`, { headers: headers ?? {} }); if (res.ok) setPubsList(await res.json()) } catch {} }}>Публикации</button>
                      <button className="rounded border px-2 py-0.5 text-xs" onClick={()=>{ setPwdUserId(u.id); setPwdValue('') }}>Сбросить пароль</button>
                      {u.active ? (
                        <button className="rounded bg-yellow-500 text-white px-2 py-0.5 text-xs" onClick={async()=>{ await fetch(`${API_BASE}/admin/users/${u.id}/active`, { method:'PATCH', headers:{ ...(headers||{}), 'Content-Type':'application/json' }, body: JSON.stringify({ active: 0 }) }); setUsers(prev => prev.map(x => x.id===u.id? { ...x, active:0 }: x)) }}>Заблокировать</button>
                      ) : (
                        <button className="rounded bg-green-600 text-white px-2 py-0.5 text-xs" onClick={async()=>{ await fetch(`${API_BASE}/admin/users/${u.id}/active`, { method:'PATCH', headers:{ ...(headers||{}), 'Content-Type':'application/json' }, body: JSON.stringify({ active: 1 }) }); setUsers(prev => prev.map(x => x.id===u.id? { ...x, active:1 }: x)) }}>Разблокировать</button>
                      )}
                      <button className="rounded bg-red-600 text-white px-2 py-0.5 text-xs" onClick={async()=>{ if (!confirm('Удалить пользователя?')) return; const res = await fetch(`${API_BASE}/admin/users/${u.id}`, { method:'DELETE', headers: headers||{} }); if (res.ok) setUsers(prev => prev.filter(x=>x.id!==u.id)) }}>Удалить</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Pagination controls */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">Страница {page} из {totalPages}. Всего: {roleStr==='admin' ? totalCount : filtered.length}</div>
          <div className="flex items-center gap-2">
            <button className="rounded border px-3 py-1" disabled={page<=1} onClick={()=>setPage(1)}>« Первая</button>
            <button className="rounded border px-3 py-1" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹ Назад</button>
            <button className="rounded border px-3 py-1" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Вперёд ›</button>
            <button className="rounded border px-3 py-1" disabled={page>=totalPages} onClick={()=>setPage(totalPages)}>Последняя »</button>
          </div>
        </div>
      </div>

      {/* Modals */}
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
    </>
  )
}
