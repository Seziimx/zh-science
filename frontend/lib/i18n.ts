import ru from '../static/i18n/ru.json'
import kz from '../static/i18n/kz.json'
import { useEffect, useState } from 'react'

export type Lang = 'ru' | 'kz'

function getByPath(obj: any, path: string): any {
  return path.split('.').reduce((acc: any, key: string) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj)
}

export function useI18n(lang: Lang) {
  const dict = lang === 'kz' ? (kz as any) : (ru as any)
  return (key: string): string => {
    const v = getByPath(dict, key)
    return typeof v === 'string' ? v : key
  }
}

// Global language hook synced with localStorage
const LANG_KEY = 'lang'
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'kz'
    const saved = (localStorage.getItem(LANG_KEY) as Lang | null)
    return saved === 'ru' || saved === 'kz' ? saved : 'kz'
  })
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LANG_KEY && (e.newValue === 'ru' || e.newValue === 'kz')) {
        setLang(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const update = (l: Lang) => {
    setLang(l)
    if (typeof window !== 'undefined') localStorage.setItem(LANG_KEY, l)
  }
  return [lang, update]
}
