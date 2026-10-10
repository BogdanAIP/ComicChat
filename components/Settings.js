import { useEffect, useState } from 'react'
import Profile from './Profile'
import useTranslation from '../utils/useTranslation'
import { usePreferences, LOCALES, THEMES } from '../utils/usePreferences'
import styles from '../styles/Settings.module.css'

export default function Settings({ currentUser, session, supabase, onBack }) {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  useEffect(() => { let live = true; supabase.rpc('comic_get_my_account_state').then(({data,error}) => {
    if (live && !error) setPending((Array.isArray(data) ? data[0] : data)?.status === 'deletion_requested')
  }); return () => { live = false } }, [supabase])
  async function exportData() {
    if (busy) return
    setBusy(true); setStatus('')
    try {
      const { data, error } = await supabase.rpc('comic_export_my_data')
      if (error || !data) throw error || new Error('No export')
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}))
      const link = document.createElement('a')
      link.href = url; link.download = 'comicchat-export-' + new Date().toISOString().slice(0,10) + '.json'
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus(t.exportDone)
    } catch { setStatus(t.actionFailed) } finally { setBusy(false) }
  }
  async function deletion() {
    if (busy || (!pending && !window.confirm(t.deleteConfirm))) return
    setBusy(true); setStatus('')
    try {
      const { error } = await supabase.rpc(pending ? 'comic_cancel_account_deletion' : 'comic_request_account_deletion')
      if (error) throw error
      setPending(!pending); setStatus(t.statusUpdated)
    } catch { setStatus(t.actionFailed) } finally { setBusy(false) }
  }
  return <section className={styles.page} data-testid="settings-page">
    <header className={styles.heading}><h1>{t.settings}</h1><button type="button" onClick={onBack}>{t.backToChats}</button></header>
    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="appearance-title">
        <h2 id="appearance-title">{t.appearance}</h2>
        <label className={styles.field} htmlFor="ui-language">{t.language}
          <select id="ui-language" data-testid="ui-language" value={preferences.locale} onChange={e => preferences.update({locale:e.target.value})}>
            {LOCALES.map(locale => <option key={locale} value={locale}>{({ru:'Русский',en:'English',ar:'العربية'})[locale]}</option>)}
          </select>
        </label>
        <fieldset className={styles.themes}><legend>{t.theme}</legend>
          {THEMES.map(theme => <label key={theme} className={styles.theme} data-theme-preview={theme}>
            <input type="radio" name="ui-theme" value={theme} checked={preferences.theme === theme}
              onChange={() => preferences.update({theme})} data-testid={'theme-' + theme} />
            <span aria-hidden="true" className={styles.preview}>✦ Aa</span><span>{t['theme_' + theme]}</span>
          </label>)}
        </fieldset>
        <p>{t.themeHelp}</p>
        <p role="status" data-testid="preferences-status">{preferences.sync === 'saving' ? t.saving : preferences.sync === 'local' ? t.preferencesLocal : preferences.sync === 'saved' ? t.savedPreferences : ''}</p>
      </section>
      <section className={styles.card} aria-labelledby="account-title">
        <h2 id="account-title">{t.account}</h2>
        <Profile currentUser={currentUser} session={session} supabase={supabase} embedded />
        {session?.user?.email && <div className={styles.email}>
          <button type="button" aria-expanded={showEmail} onClick={() => setShowEmail(!showEmail)}>{showEmail ? t.hideEmail : t.showEmail}</button>
          {showEmail && <p>{t.emailPrivate}: <span>{session.user.email}</span></p>}
        </div>}
      </section>
      <section className={styles.card} aria-labelledby="privacy-title">
        <h2 id="privacy-title">{t.privacyData}</h2>
        <button type="button" data-testid="export-data" onClick={exportData} disabled={busy}>{busy ? t.updating : t.exportMyData}</button>
        <p>{t.deleteHelp}</p>
        <button type="button" data-testid="account-deletion" onClick={deletion} disabled={busy} className={styles.danger}>{pending ? t.cancelDeletion : t.requestDeletion}</button>
        {status && <p role="status">{status}</p>}
      </section>
    </div>
  </section>
}
