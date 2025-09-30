import type { AppProps } from 'next/app'
import Head from 'next/head'
import '../styles/globals.css'
import NavBar from '../components/NavBar'
import { useEffect } from 'react'
import { INACTIVITY_TIMEOUT_MS, markActivity, maybeExpireSession } from '../lib/auth'

export default function MyApp({ Component, pageProps }: AppProps) {
  // Global inactivity tracker / auto-logout
  useEffect(() => {
    if (typeof window === 'undefined') return
    // mark activity on typical user events
    const events = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart', 'visibilitychange']
    const onActivity = () => markActivity()
    events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }))

    // periodic check for expiration
    const check = () => {
      const expired = maybeExpireSession()
      if (expired) {
        try { alert('Сессия завершена из-за неактивности (24 часа). Пожалуйста, войдите снова.') } catch {}
      }
    }
    const id = window.setInterval(check, Math.max(60_000, Math.floor(INACTIVITY_TIMEOUT_MS / 24))) // at least once per minute
    // run initial check on mount
    check()
    return () => {
      events.forEach(ev => window.removeEventListener(ev, onActivity))
      window.clearInterval(id)
    }
  }, [])
  return (
    <>
      <Head>
        {/* Favicon */}
        <link rel="icon" href="/zhubanov.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="viewport" content="initial-scale=1, width=device-width" />

        {/* Мета */}
        <meta name="viewport" content="initial-scale=1, width=device-width" />
        <title>Science-ARSU</title>
      </Head>
      <NavBar />
      <Component {...pageProps} />
    </>
  )
}
