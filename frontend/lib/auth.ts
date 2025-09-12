export type Role = 'guest' | 'user' | 'admin' | 'teacher' | 'student'

const CLIENT_ID_KEY = 'clientId'
const ROLE_KEY = 'role'
const TOKEN_KEY = 'token'

function uuidv4() {
  // simple UUIDv4 generator for client id
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function ensureClientId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    id = uuidv4()
    localStorage.setItem(CLIENT_ID_KEY, id)
  }
  return id
}

export function getRole(): Role {
  if (typeof window === 'undefined') return 'guest'
  const r = localStorage.getItem(ROLE_KEY) as Role | null
  return (r === 'user' || r === 'admin' || r === 'teacher' || r === 'student') ? r : 'guest'
}

export function getToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setAuth(role: Role, token?: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(ROLE_KEY, role)
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  ensureClientId()
}

export function clearAuth() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(TOKEN_KEY)
  localStorage.setItem(ROLE_KEY, 'guest')
}

export function authHeaders(): HeadersInit {
  const token = getToken()
  const cid = ensureClientId()
  const h: Record<string, string> = {}
  if (token) h['Authorization'] = `Bearer ${token}`
  if (cid) h['X-Client-Id'] = cid
  return h
}
