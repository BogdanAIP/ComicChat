import Head from 'next/head'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useState } from 'react'

import Auth from '../../components/Auth'
import { supabase } from '../../utils/useSupabase'

export default function OAuthConsent() {
  const router = useRouter()
  const [phase, setPhase] = useState('loading')
  const [details, setDetails] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const authorizationId =
    typeof router.query.authorization_id === 'string'
      ? router.query.authorization_id
      : ''

  const loadAuthorization = useCallback(async () => {
    if (!authorizationId) return

    setError('')
    const { data: userData, error: userError } = await supabase.auth.getUser()

    if (userError || !userData.user) {
      setDetails(null)
      setPhase('signin')
      return
    }

    const { data, error: authorizationError } =
      await supabase.auth.oauth.getAuthorizationDetails(authorizationId)

    if (authorizationError || !data) {
      setError(authorizationError?.message || 'Invalid OAuth authorization request.')
      setPhase('error')
      return
    }

    if (!('authorization_id' in data)) {
      window.location.assign(data.redirect_url)
      return
    }

    setDetails(data)
    setPhase('consent')
  }, [authorizationId])

  useEffect(() => {
    if (!router.isReady) return

    if (!authorizationId) {
      setError('Missing authorization_id.')
      setPhase('error')
      return
    }

    loadAuthorization()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setTimeout(loadAuthorization, 0)
      }
    })

    return () => subscription.unsubscribe()
  }, [authorizationId, loadAuthorization, router.isReady])

  const decide = async (approved) => {
    if (!authorizationId || busy) return

    setBusy(true)
    setError('')

    const action = approved
      ? supabase.auth.oauth.approveAuthorization(authorizationId)
      : supabase.auth.oauth.denyAuthorization(authorizationId)

    const { data, error: decisionError } = await action

    if (decisionError || !data?.redirect_url) {
      setError(decisionError?.message || 'Unable to finish OAuth authorization.')
      setBusy(false)
      return
    }

    window.location.assign(data.redirect_url)
  }

  const scopes =
    typeof details?.scope === 'string'
      ? details.scope.split(/\s+/).filter(Boolean)
      : []

  return (
    <>
      <Head>
        <title>Connect ComicChat</title>
        <meta
          name="description"
          content="Authorize a ChatGPT or MCP client to access your private ComicChat account."
        />
      </Head>

      <main style={styles.page}>
        <section style={styles.card} aria-live="polite">
          <p style={styles.eyebrow}>ComicChat OAuth 2.1</p>
          <h1 style={styles.title}>Connect your ComicChat account</h1>

          {phase === 'loading' && <p>Loading authorization request…</p>}

          {phase === 'signin' && (
            <>
              <p style={styles.copy}>
                Sign in to the ComicChat account you want to connect. No ChatGPT
                history or OpenAI token is requested.
              </p>
              <Auth supabase={supabase} />
            </>
          )}

          {phase === 'consent' && details && (
            <>
              <p style={styles.copy}>
                <strong>{details.client?.name || 'An MCP client'}</strong> is
                requesting access to your private ComicChat account.
              </p>

              <dl style={styles.summary}>
                <dt>Client</dt>
                <dd>{details.client?.name || 'Unknown client'}</dd>
                <dt>Redirect URI</dt>
                <dd style={styles.break}>{details.redirect_uri}</dd>
                <dt>Requested permissions</dt>
                <dd>
                  {scopes.length > 0 ? scopes.join(', ') : 'ComicChat account access'}
                </dd>
              </dl>

              <p style={styles.copy}>
                ComicChat will continue to enforce membership-scoped RLS for
                conversations and messages. Sending a message remains an explicit
                write action.
              </p>

              {error && <p style={styles.error}>{error}</p>}

              <div style={styles.actions}>
                <button
                  type="button"
                  onClick={() => decide(false)}
                  disabled={busy}
                  style={styles.secondary}
                >
                  Deny
                </button>
                <button
                  type="button"
                  onClick={() => decide(true)}
                  disabled={busy}
                  style={styles.primary}
                >
                  {busy ? 'Connecting…' : 'Allow'}
                </button>
              </div>
            </>
          )}

          {phase === 'error' && <p style={styles.error}>{error}</p>}
        </section>
      </main>
    </>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    background: '#f4f1e8',
    color: '#1e1e1e',
  },
  card: {
    width: 'min(680px, 100%)',
    border: '3px solid currentColor',
    borderRadius: 18,
    padding: 28,
    background: '#fffdf7',
    boxShadow: '8px 8px 0 #1e1e1e',
  },
  eyebrow: {
    margin: 0,
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: { margin: '8px 0 18px', fontSize: 32 },
  copy: { lineHeight: 1.55 },
  summary: {
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 0.35fr) 1fr',
    gap: '10px 16px',
    padding: 16,
    border: '2px solid currentColor',
    borderRadius: 12,
  },
  break: { overflowWrap: 'anywhere' },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
  primary: {
    border: '2px solid #1e1e1e',
    borderRadius: 10,
    padding: '10px 18px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondary: {
    border: '2px solid #1e1e1e',
    borderRadius: 10,
    padding: '10px 18px',
    background: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  error: { color: '#8b0000', fontWeight: 700 },
}
