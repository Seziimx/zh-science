import Head from 'next/head'
import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { ensureClientId, setAuth } from '../lib/auth'

// Use env if set; otherwise default to production API on Render
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://zh-science-1.onrender.com'


type LoginResp = { role: 'user'|'admin'; token: string }

export default function LoginPage() {
  const t = useI18n('ru')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        try {
          const j = await res.json()
          throw new Error(j.detail || 'Неверный логин или пароль')
        } catch {
          throw new Error('Неверный логин или пароль')
        }
      }
      const data: LoginResp = await res.json()
      setAuth(data.role, data.token)
      ensureClientId()
      window.location.href = '/'
    } catch (e: any) {
      const msg = e.message || String(e)
      setError(msg)
      setToast(msg)
      setTimeout(()=>setToast(null), 2500)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Head>
        <title>Вход — Science-ARSU</title>
      </Head>
      <div className="max-w-md mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-4">Вход</h1>
        {toast && (
          <div className="mb-3 rounded bg-red-100 border border-red-300 text-red-800 px-3 py-2">{toast}</div>
        )}
        <form onSubmit={onSubmit} className="rounded border bg-white p-4 space-y-3">
          <div>
            <label className="block text-sm text-gray-600">Логин</label>
            <input className="w-full rounded border px-3 py-2" value={username} onChange={e=>setUsername(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm text-gray-600">Пароль</label>
            <input className="w-full rounded border px-3 py-2" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button disabled={loading} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-50" type="submit">
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </div>
    </>
  )
}
