import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { getRole, clearAuth, type Role } from '../lib/auth'

type Lang = 'ru' | 'kz'

export default function NavBar() {
  const [lang, setLang] = useState<Lang>('ru')
  const [role, setRole] = useState<Role>(() => 'guest')
  const [mounted, setMounted] = useState(false)
  const t = useI18n(lang)

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? (localStorage.getItem('lang') as Lang | null) : null
    if (saved === 'ru' || saved === 'kz') setLang(saved)
    setMounted(true)
    setRole(getRole())
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('lang', lang)
  }, [lang])

  useEffect(() => {
    const onStorage = () => setRole(getRole())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <header className="bg-white border-b sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-primary">
            <img src="/zhubanov.png" alt="Logo" className="h-10 w-10 rounded-full object-contain" />
            {t('siteTitle')}
          </Link>
          <nav className="hidden sm:flex items-center gap-4 text-sm text-gray-700">
            <Link href="/" className="hover:text-primary">{t('menu.home')}</Link>
            <Link href="/stats" className="hover:text-primary">{t('menu.stats')}</Link>
            <Link href="/authors" className="hover:text-primary">Авторы</Link>
            {mounted && role !== 'guest' && (
              <Link href="/add" className="hover:text-primary">{t('common.upload')}</Link>
            )}
            {mounted && (role === 'user' || role === 'teacher' || role === 'student') && (
              <Link href="/mine" className="hover:text-primary">{t('menu.mine')}</Link>
            )}
            {mounted && role === 'admin' && (
              <Link href="/admin" className="hover:text-primary">{t('menu.admin')}</Link>
            )}
            {mounted && role === 'guest' ? (
              <Link href="/login" className="hover:text-primary">{t('menu.login') || 'Вход'}</Link>
            ) : (
              <button onClick={()=>{ clearAuth(); setRole('guest'); if (typeof window!== 'undefined') window.location.href='/' }} className="hover:text-primary">{t('menu.logout')}</button>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-block text-xs text-gray-600" suppressHydrationWarning>
            {mounted ? `${t('common.loggedAs') || 'Вы вошли как:'} ${role}` : ''}
          </span>
          <button
            className={`border rounded px-2 py-0.5 text-sm ${lang==='ru'?'bg-primary text-white':'bg-white'}`}
            onClick={() => setLang('ru')}
          >ru</button>
          <button
            className={`border rounded px-2 py-0.5 text-sm ${lang==='kz'?'bg-primary text-white':'bg-white'}`}
            onClick={() => setLang('kz')}
          >kz</button>
        </div>
        {/* removed static logout button to avoid hydration mismatch */}
      </div>
    </header>
  )
}
