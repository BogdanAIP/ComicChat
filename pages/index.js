import Head from 'next/head'
import { motion, AnimatePresence } from 'framer-motion'
import styles from '../styles/Home.module.css'
import sidebarStyles from '../styles/Sidebar.module.css'
import Auth from '../components/Auth'
import ComicDirectMessages from '../components/ComicDirectMessages'
import ComicStoryFeed from '../components/ComicStoryFeed'
import ComicGroupChat from '../components/ComicGroupChat'
import Profile from '../components/Profile'
import useTranslation from '../utils/useTranslation'
import { useEffect, useRef, useState } from 'react'
import usePasswordRecovery from '../utils/usePasswordRecovery'

const tabTransition = {
  duration: 0.26,
  ease: [0.22, 1, 0.36, 1],
}

export default function Home({ currentUser, session, supabase }) {
  const { t, locale, toggleLanguage } = useTranslation()
  const [tab, setTab] = useState('private')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isDesktop, setIsDesktop] = useState(true)
  const sidebarRef = useRef(null)
  const toggleRef = useRef(null)
  const { recoveryMode, finishRecovery } = usePasswordRecovery(supabase)
  const loggedIn = !!session && !recoveryMode


  useEffect(() => {
    const checkDesktop = () => {
      const desktop = window.innerWidth > 768
      setIsDesktop(desktop)
      if (!desktop) setSidebarOpen(false)
    }
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  useEffect(() => {
    if (!sidebarOpen || isDesktop || !loggedIn) return undefined
    const menu = sidebarRef.current
    menu?.querySelector('button')?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSidebarOpen(false)
        toggleRef.current?.focus()
      } else if (event.key === 'Tab') {
        const controls = Array.from(menu?.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]') || [])
        // The visible close button participates in the mobile menu focus loop.
        controls.push(toggleRef.current)
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sidebarOpen, isDesktop, loggedIn])

  const navigate = (nextTab) => {
    setTab(nextTab)
    if (!isDesktop) {
      setSidebarOpen(false)
      toggleRef.current?.focus()
    }
  }

  const getAvatarLetter = () => {
    const name = currentUser?.username || session?.user?.email || 'U'
    return name[0].toUpperCase()
  }

  const desktopSidebarOpen = loggedIn && isDesktop && sidebarOpen
  const mainMargin = desktopSidebarOpen ? 'var(--sidebar-w)' : '0'
  const mainWidth = desktopSidebarOpen
    ? 'calc(100% - var(--sidebar-w))'
    : '100%'

  return (
    <div className={styles.container}>
      <Head>
        <title>ComicChat</title>
        <meta
          name="description"
          content="Private comic-first conversations where each message becomes a visual panel."
        />
      </Head>

      <main
        className={styles.main}
        inert={loggedIn && !isDesktop && sidebarOpen ? '' : undefined}
        style={{
          marginInlineEnd: mainMargin,
          width: mainWidth,
        }}
      >
        <AnimatePresence mode="wait">
          {!loggedIn ? (
            <motion.div
              key="auth"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={tabTransition}
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Auth supabase={supabase} recoveryMode={recoveryMode} session={session} onRecoveryComplete={finishRecovery} />
            </motion.div>
          ) : (
            <motion.div
              key={tab}
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -18 }}
              transition={tabTransition}
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {tab === 'groups' ? (
                <ComicGroupChat session={session} supabase={supabase} />
              ) : tab === 'stories' ? (
                <ComicStoryFeed supabase={supabase} />
              ) : tab === 'profile' ? (
                <Profile
                  currentUser={currentUser}
                  session={session}
                  supabase={supabase}
                  onBack={() => setTab('private')}
                />
              ) : (
                <ComicDirectMessages
                  session={session}
                  supabase={supabase}
                  onOpenProfile={() => setTab('profile')}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {loggedIn && (
        <>
          <div
            className={`${sidebarStyles.sidebarOverlay} ${sidebarOpen ? sidebarStyles.open : ''}`}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />

          <div
            ref={sidebarRef}
            id="comicchat-navigation"
            inert={!sidebarOpen ? '' : undefined}
            aria-hidden={!sidebarOpen}
            role={!isDesktop ? 'dialog' : undefined}
            aria-modal={!isDesktop && sidebarOpen ? 'true' : undefined}
            aria-label={t.navigation}
            className={`${sidebarStyles.sidebar} ${sidebarOpen ? sidebarStyles.open : ''} ${!sidebarOpen && isDesktop ? sidebarStyles.closed : ''}`}
          >
            <div className={sidebarStyles.sidebarHeader}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2><span className={sidebarStyles.brandMark} aria-hidden="true">✦</span> ComicChat</h2>
                <button 
                  onClick={toggleLanguage}
                  className={sidebarStyles.langToggle}
                  title={t.language}
                >
                  {locale === 'ar' ? 'EN' : 'AR'}
                </button>
              </div>
              <p>{t.brandSubtitle}</p>
              <span className={sidebarStyles.brandIssue}>{t.privateEdition}</span>
            </div>

            <nav className={sidebarStyles.navItems} aria-label={t.navigation}>
              {[
                ['private', 'comicchat-nav', '✦', 'ComicChat'],
                ['groups', 'groups-nav', '▣', t.groups],
                ['stories', 'stories-nav', '▧', t.stories],
                ['profile', 'profile-nav', '👤', t.profile],
              ].map(([value, testId, icon, label]) => (
                <button key={value} type="button" data-testid={testId}
                  className={`${sidebarStyles.navItem} ${tab === value ? sidebarStyles.active : ''}`}
                  aria-current={tab === value ? 'page' : undefined}
                  onClick={() => navigate(value)}>
                  <span className={sidebarStyles.navItemIcon} aria-hidden="true">{icon}</span>
                  <span className={sidebarStyles.navItemText}>{label}</span>
                </button>
              ))}
            </nav>

            <div className={sidebarStyles.userInfo}>
              <div className={sidebarStyles.userAvatar}>{getAvatarLetter()}</div>
              <div className={sidebarStyles.userName}>
                {currentUser?.username || t.unnamed}
              </div>
              <div className={sidebarStyles.userEmail}>{session?.user?.email}</div>
            </div>
          </div>

          <motion.button
            ref={toggleRef}
            type="button"
            aria-controls="comicchat-navigation"
            aria-expanded={sidebarOpen}
            className={sidebarStyles.sidebarToggle}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            whileTap={{ scale: 0.94 }}
            aria-label={sidebarOpen ? t.closeMenu : t.openMenu}
          >
            {sidebarOpen ? '✕' : '☰'}
          </motion.button>
        </>
      )}
    </div>
  )
}
