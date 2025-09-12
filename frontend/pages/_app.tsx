import type { AppProps } from 'next/app'
import Head from 'next/head'
import '../styles/globals.css'
import NavBar from '../components/NavBar'

export default function MyApp({ Component, pageProps }: AppProps) {
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
