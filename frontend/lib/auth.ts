export type Role = 'guest' | 'user' | 'admin' | 'teacher' | 'student'

const CLIENT_ID_KEY = 'clientId'
const ROLE_KEY = 'role'
const TOKEN_KEY = 'token'
const USER_ID_KEY = 'user_id'
const LAST_ACTIVE_AT_KEY = 'last_active_at'
// 24 hours inactivity timeout
export const INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000

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

export function getUserId(): number | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(USER_ID_KEY)
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function setAuth(role: Role, token?: string, userId?: number | null) {
  if (typeof window === 'undefined') return
  localStorage.setItem(ROLE_KEY, role)
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  if (userId !== undefined) {
    if (userId === null) localStorage.removeItem(USER_ID_KEY)
    else localStorage.setItem(USER_ID_KEY, String(userId))
  }
  // mark activity on auth change
  try { localStorage.setItem(LAST_ACTIVE_AT_KEY, String(Date.now())) } catch {}
  ensureClientId()
}

export function clearAuth() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_ID_KEY)
  localStorage.setItem(ROLE_KEY, 'guest')
}

export function authHeaders(): HeadersInit {
  const token = getToken()
  const cid = ensureClientId()
  const uid = getUserId()
  const h: Record<string, string> = {}
  if (token) h['Authorization'] = `Bearer ${token}`
  if (cid) h['X-Client-Id'] = cid
  if (uid !== null) h['X-User-Id'] = String(uid)
  return h
}

// Activity helpers
export function markActivity() {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LAST_ACTIVE_AT_KEY, String(Date.now())) } catch {}
}

export function isSessionExpired(now: number = Date.now()): boolean {
  if (typeof window === 'undefined') return false
  try {
    const v = localStorage.getItem(LAST_ACTIVE_AT_KEY)
    if (!v) return false // not tracked yet
    const last = Number(v)
    if (!Number.isFinite(last)) return false
    return now - last > INACTIVITY_TIMEOUT_MS
  } catch { return false }
}

// Clears auth if expired; returns true if it did
export function maybeExpireSession(): boolean {
  if (typeof window === 'undefined') return false
  if (isSessionExpired()) {
    clearAuth()
    return true
  }
  return false
}
