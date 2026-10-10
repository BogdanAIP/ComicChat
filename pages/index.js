import Head from 'next/head'
import { useState } from 'react'
import Auth from '../components/Auth'
import ComicDirectMessages from '../components/ComicDirectMessages'
import ComicGroupChat from '../components/ComicGroupChat'
import ComicStoryFeed from '../components/ComicStoryFeed'
import Settings from '../components/Settings'
import useTranslation from '../utils/useTranslation'
import { PreferencesProvider } from '../utils/usePreferences'
import usePasswordRecovery from '../utils/usePasswordRecovery'
import styles from '../styles/Home.module.css'

export default function Home(props) {
  return <PreferencesProvider key={props.session?.user?.id || 'guest'} userId={props.session?.user?.id} supabase={props.supabase}><Workspace {...props} /></PreferencesProvider>
}
function Workspace({ currentUser, session, supabase }) {
  const { t, locale, setLanguage } = useTranslation()
  const [tab, setTab] = useState('private')
  const { recoveryMode, finishRecovery } = usePasswordRecovery(supabase)
  const loggedIn = !!session && !recoveryMode
  return <div className={styles.container} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <Head><title>ComicChat</title><meta name="description" content={t.brandSubtitle} /></Head>
    <header className={styles.header}>
      <a className={styles.brand} href="#" onClick={e => { e.preventDefault(); setTab('private') }} aria-label="ComicChat"><span aria-hidden="true">✦</span> ComicChat</a>
      {!loggedIn && <label className={styles.guestLanguage}>{t.language}<select data-testid="auth-language" aria-label={t.language} value={locale} onChange={e=>setLanguage(e.target.value)}><option value="ru">Русский</option><option value="en">English</option><option value="ar">العربية</option></select></label>}
      {loggedIn && <nav className={styles.navigation} aria-label={t.navigation}>
        {[
          ['private','comicchat-nav',t.chats], ['groups','groups-nav',t.groups],
          ['stories','stories-nav',t.stories], ['settings','settings-nav',t.settings],
        ].map(([value,id,label]) => <button type="button" key={value} data-testid={id} onClick={() => setTab(value)}
          aria-current={tab === value ? 'page' : undefined} className={tab === value ? styles.active : ''}>{label}</button>)}
      </nav>}
      {loggedIn && <button type="button" className={styles.identity} data-testid="profile-nav" onClick={() => setTab('settings')}>
        <span className={styles.avatar} aria-hidden="true">{(currentUser?.username || '?')[0].toUpperCase()}</span>
        <span className={styles.username}>{currentUser?.username || t.unnamed}</span>
      </button>}
    </header>
    <main className={styles.main}>
      {!loggedIn ? <Auth supabase={supabase} recoveryMode={recoveryMode} session={session} onRecoveryComplete={finishRecovery} /> :
        tab === 'groups' ? <ComicGroupChat session={session} supabase={supabase} /> :
        tab === 'stories' ? <ComicStoryFeed supabase={supabase} /> :
        tab === 'settings' ? <Settings currentUser={currentUser} session={session} supabase={supabase} onBack={() => setTab('private')} /> :
        <ComicDirectMessages session={session} supabase={supabase} onOpenProfile={() => setTab('settings')} />}
    </main>
  </div>
}
