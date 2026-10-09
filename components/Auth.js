import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import styles from '../styles/Auth.module.css'
import useTranslation from '../utils/useTranslation'

export default function Auth({ supabase, recoveryMode = false, session = null, onRecoveryComplete }) {
  const { t, locale } = useTranslation()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const isSignUp = mode === 'signup'
  const isReset = mode === 'reset' && !recoveryMode

  const handleAuth = async (event) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setMessage({ type: '', text: '' })
    try {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin
      if (recoveryMode) {
        if (!session) throw new Error(t.recoverySessionRequired)
        if (password !== passwordConfirmation) throw new Error(t.passwordMismatch)
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        setPassword('')
        setPasswordConfirmation('')
        setMessage({ type: 'success', text: t.passwordUpdated })
        await onRecoveryComplete?.()
      } else if (isReset) {
        const redirectTo = new URL(`/${locale}?recovery=1`, siteUrl).href
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        if (error) throw error
        // The same message for unknown addresses avoids revealing membership.
        setMessage({ type: 'success', text: t.resetEmailSent })
      } else if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: new URL(`/${locale}`, siteUrl).href },
        })
        if (error) throw error
        setMessage({ type: 'success', text: data?.session ? t.accountCreatedOpening : t.accountCreatedConfirm })
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setMessage({ type: 'success', text: t.loggedInSuccessfully })
      }
    } catch (authError) {
      setMessage({ type: 'error', text: authError.message || t.errorAuth })
    } finally {
      setLoading(false)
    }
  }

  const changeMode = (nextMode) => {
    setMode(nextMode)
    setPassword('')
    setPasswordConfirmation('')
    setMessage({ type: '', text: '' })
  }

  return (
    <div className={styles.container}>
      <motion.div className={styles.authCard}
        initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35 }}>
        <div className={styles.brandBadge} aria-label="ComicChat">
          <span aria-hidden="true">✦</span><span>ComicChat</span><small>VOL. 01</small>
        </div>
        {!recoveryMode && !isReset && <p className={styles.productIdea}>{t.authProductIdea}</p>}
        <h2 className={styles.title}>
          {recoveryMode ? t.setNewPassword : isReset ? t.resetPassword : isSignUp ? t.register : t.login}
        </h2>
        <p className={styles.subtitle}>{recoveryMode ? t.recoverySubtitle : isReset ? t.resetSubtitle : t.authSub}</p>
        <form onSubmit={handleAuth} className={styles.form}>
          {!recoveryMode && <div className={styles.inputGroup}>
            <label htmlFor="email" className={styles.label}>{t.emailPlaceholder}</label>
            <input id="email" data-testid="auth-email" type="email" autoComplete="email"
              value={email} onChange={(event) => setEmail(event.target.value)} className={styles.input}
              placeholder="example@email.com" required disabled={loading} />
          </div>}
          {!isReset && <div className={styles.inputGroup}>
            <label htmlFor="password" className={styles.label}>{t.passwordPlaceholder}</label>
            <div className={styles.passwordField}>
              <input id="password" data-testid="auth-password" type={showPassword ? 'text' : 'password'}
                autoComplete={isSignUp || recoveryMode ? 'new-password' : 'current-password'}
                value={password} onChange={(event) => setPassword(event.target.value)} className={styles.input}
                placeholder="••••••••" required minLength={6} disabled={loading} />
              <button type="button" data-testid="auth-show-password" className={styles.passwordToggle}
                aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} disabled={loading}>
                {showPassword ? t.hidePassword : t.showPassword}
              </button>
            </div>
          </div>}
          {recoveryMode && <div className={styles.inputGroup}>
            <label htmlFor="password-confirmation" className={styles.label}>{t.confirmPassword}</label>
            <input id="password-confirmation" data-testid="auth-password-confirmation"
              type={showPassword ? 'text' : 'password'} autoComplete="new-password"
              value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)}
              className={styles.input} minLength={6} required disabled={loading} />
          </div>}
          <AnimatePresence>
            {message.text && <motion.div className={`${styles.message} ${styles[message.type]}`}
              role={message.type === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {message.text}
            </motion.div>}
          </AnimatePresence>
          <motion.button type="submit" data-testid="auth-submit" className={styles.submitButton}
            disabled={loading || (recoveryMode && !session)} whileTap={{ scale: loading ? 1 : 0.99 }}>
            {loading ? t.loading : recoveryMode ? t.savePassword : isReset ? t.sendResetLink : isSignUp ? t.register : t.login}
          </motion.button>
        </form>
        {!recoveryMode && <div className={styles.switch}>
          <span>{isReset ? t.rememberPassword : isSignUp ? t.alreadyHaveAccount : t.noAccount}</span>
          <button type="button" onClick={() => changeMode(isSignUp || isReset ? 'login' : 'signup')}
            className={styles.switchButton} disabled={loading}>{isSignUp || isReset ? t.login : t.register}</button>
        </div>}
        {!recoveryMode && mode === 'login' && <button type="button" data-testid="auth-reset-password"
          onClick={() => changeMode('reset')} className={styles.resetButton} disabled={loading}>{t.forgotPassword}</button>}
        {recoveryMode && !session && <p className={styles.message} role="status">{t.recoverySessionRequired}</p>}
        {recoveryMode && <button type="button" className={styles.resetButton} disabled={loading}
          onClick={async () => { await supabase.auth.signOut(); await onRecoveryComplete?.() }}>{t.cancel}</button>}
      </motion.div>
    </div>
  )
}
