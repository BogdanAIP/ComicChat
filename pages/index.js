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
      <a className={styles.brand} href="#" onClick={e => { e.preventDefault(); setTab('private') }} aria-label="ComicChat"><span aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M4 6h24l8 8v20H4z" fill="currentColor" opacity=".15"/><path d="M4 6h24l8 8v20H4zM4 21h32M20 6v15M17 21v13" stroke="currentColor" strokeWidth="2.5"/><path d="M8 11h8v6h-3l-3 3v-3H8zM23 25h8v5h-4l-2 3v-3h-2z" fill="currentColor"/></svg></span> ComicChat</a>
      {!loggedIn && <label className={styles.guestLanguage}>{t.language}<select data-testid="auth-language" aria-label={t.language} value={locale} onChange={e=>setLanguage(e.target.value)}><option value="ru">Русский</option><option value="en">English</option><option value="ar">العربية</option></select></label>}
      {loggedIn && <nav className={styles.navigation} aria-label={t.navigation}>
        {[
          ['private','comicchat-nav',t.chats], ['groups','groups-nav',t.groups],
          ['stories','stories-nav',t.stories], ['settings','settings-nav',t.settings],
        ].map(([value,id,label]) => <button type="button" key={value} data-testid={id} onClick={() => setTab(value)}
          aria-current={tab === value ? 'page' : undefined} className={tab === value ? styles.active : ''}><NavIcon tab={value} />{label}</button>)}
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

function NavIcon({tab}) {
 const paths={private:'M4 4h16v12H10l-5 4v-4H4z',groups:'M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8-1a3 3 0 1 0 0-6M2 21v-2a6 6 0 0 1 12 0v2m2-7a5 5 0 0 1 6 5v2',stories:'M3 4h8v16H3zM13 4h8v7h-8zM13 13h8v7h-8z',settings:'M4 7h16M4 17h16M8 4v6M16 14v6'};
 return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[tab]}/></svg>
}
