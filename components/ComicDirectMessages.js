import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import ComicPanel from './ComicPanel'
import ComicStylePicker from './ComicStylePicker'
import useComicChatStyles from '../utils/useComicChatStyles'
import useComicMessages from '../utils/useComicMessages'
import useComicScroll from '../utils/useComicScroll'
import useConversationDraft from '../utils/useConversationDraft'
import { makeUuid, mergeMessage, reusableSendAttempt } from '../utils/comicMessages.mjs'
import useTranslation from '../utils/useTranslation'
import styles from '../styles/ComicDirectMessages.module.css'
import ComicWelcome from './ComicWelcome'
import ComicStoryPermissions from './ComicStoryPermissions'

const REPORT_REASONS = [
  ['spam', 'Spam'],
  ['harassment', 'Harassment'],
  ['threats', 'Threats'],
  ['sexual_content', 'Sexual content'],
  ['hate', 'Hate or hateful conduct'],
  ['self_harm', 'Self-harm concern'],
  ['other', 'Other'],
]

const ComicDirectMessages = forwardRef(({ session, supabase, onOpenProfile }, ref) => {
  const myUserId = session?.user?.id

  if (!myUserId) return null

  return (
    <ComicDirectMessagesContent
      session={session}
      supabase={supabase}
      forwardedRef={ref}
      onOpenProfile={onOpenProfile}
    />
  )
})

ComicDirectMessages.displayName = 'ComicDirectMessages'

function ComicDirectMessagesContent({ session, supabase, forwardedRef, onOpenProfile }) {
  const myUserId = session.user.id
  const selectedConversationRef = useRef(null)
  const sendAttemptRef = useRef(new Map())
  const styleRefreshRef = useRef(null)
  const messagesRef = useRef(null)
  const { t } = useTranslation()
  const renderDispatchRef = useRef(new Set())

  const [conversations, setConversations] = useState([])
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [blockedUserIds, setBlockedUserIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reportTargetId, setReportTargetId] = useState(null)
  const [reportReason, setReportReason] = useState('other')
  const [reportDetails, setReportDetails] = useState('')
  const [reportRequestId, setReportRequestId] = useState(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportStatus, setReportStatus] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const [accountState, setAccountState] = useState({
    status: 'active',
    deletion_requested_at: null,
    hard_delete_enabled: false,
  })
  const [accountStateBusy, setAccountStateBusy] = useState(false)
  const [betaSafety, setBetaSafety] = useState(null)

  const selectedConversationId = selectedConversation?.conversation_id || null
  const [draft, setDraft] = useConversationDraft(selectedConversationId)
  const selectedPartnerId = selectedConversation?.other_user_id || null
  const selectedBlockedByMe = selectedPartnerId
    ? blockedUserIds.includes(selectedPartnerId)
    : false
  const deletionPending = accountState.status === 'deletion_requested'

  useEffect(() => {
    selectedConversationRef.current = selectedConversation
  }, [selectedConversation])

  const loadConversations = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('comic_list_direct_conversations')

    if (rpcError) {
      console.error('comic_list_direct_conversations failed', rpcError)
      setError('Unable to load private conversations.')
      return []
    }

    const rows = data || []
    setConversations(rows)

    const currentId = selectedConversationRef.current?.conversation_id
    if (currentId) {
      const fresh = rows.find((row) => row.conversation_id === currentId)
      if (fresh) setSelectedConversation(fresh)
    }

    return rows
  }, [supabase])

  const loadBlockedUsers = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('comic_list_blocked_users')

    if (rpcError) {
      console.error('comic_list_blocked_users failed', rpcError)
      setError('Unable to load blocked users.')
      return []
    }

    const ids = (data || []).map((row) => row.blocked_user_id)
    setBlockedUserIds(ids)
    return ids
  }, [supabase])

  const loadAccountState = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('comic_get_my_account_state')

    if (rpcError) {
      console.error('comic_get_my_account_state failed', rpcError)
      setError('Unable to load account deletion status.')
      return null
    }

    const row = Array.isArray(data) ? data[0] : data
    const nextState = row || {
      status: 'active',
      deletion_requested_at: null,
      hard_delete_enabled: false,
    }
    setAccountState(nextState)
    return nextState
  }, [supabase])

  const loadBetaSafety = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('comic_get_beta_safety_status')

    if (rpcError) {
      console.error('comic_get_beta_safety_status failed', rpcError)
      return null
    }

    const row = Array.isArray(data) ? data[0] : data
    setBetaSafety(row || null)
    return row || null
  }, [supabase])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadConversations()
      loadBlockedUsers()
      loadAccountState()
      loadBetaSafety()
    }, 0)

    return () => clearTimeout(timer)
  }, [loadAccountState, loadBetaSafety, loadBlockedUsers, loadConversations])

  useEffect(() => {
    let cancelled = false
    let channel = null

    const subscribeMemberships = async () => {
      await supabase.realtime.setAuth(session.access_token)
      if (cancelled) return

      channel = supabase
        .channel(`user:${myUserId}`, {
          config: { private: true },
        })
        .on('broadcast', { event: 'INSERT' }, () => {
          loadConversations()
        })
        .subscribe()
    }

    subscribeMemberships()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [loadConversations, myUserId, session.access_token, supabase])

  const markReceipts = useCallback(async (conversationId, markRead) => {
    if (!conversationId) return

    const delivered = await supabase.rpc('comic_mark_conversation_delivered', {
      p_conversation_id: conversationId,
    })

    if (delivered.error) {
      console.error('comic_mark_conversation_delivered failed', delivered.error)
      return
    }

    if (markRead) {
      const read = await supabase.rpc('comic_mark_conversation_read', {
        p_conversation_id: conversationId,
      })

      if (read.error) {
        console.error('comic_mark_conversation_read failed', read.error)
      }
    }
  }, [supabase])

  const onMessageActivity = useCallback(async (conversationId) => {
    await markReceipts(conversationId, typeof document !== 'undefined' && !document.hidden)
    await loadConversations()
  }, [markReceipts, loadConversations])
  const history = useComicMessages({
    supabase, session, conversationId: selectedConversationId,
    onActivity: onMessageActivity,
    onStyleChange: () => styleRefreshRef.current?.(),
  })
  const { messages, setMessages, connectionState } = history
  const chatStyles = useComicChatStyles(supabase, selectedConversationId, messages)
  useEffect(() => { styleRefreshRef.current = chatStyles.refresh }, [chatStyles.refresh])
  const messageScroll = useComicScroll(messagesRef, selectedConversationId, messages)

  useEffect(() => {
    if (!selectedConversationId || typeof document === 'undefined') return undefined

    const handleVisibility = async () => {
      if (!document.hidden) {
        await markReceipts(selectedConversationId, true)
        await loadConversations()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [loadConversations, markReceipts, selectedConversationId])

  useEffect(() => {
    if (!betaSafety?.external_generation_enabled) return undefined

    let cancelled = false

    // A retryable worker failure moves rendering -> queued. Clear the local
    // dispatch marker as soon as the message leaves queued so the later queued
    // transition can safely invoke the exact same job again.
    for (const messageId of renderDispatchRef.current) {
      const current = messages.find((message) => message.id === messageId)
      if (!current || current.status !== 'queued') {
        renderDispatchRef.current.delete(messageId)
      }
    }

    for (const message of messages) {
      if (
        message.sender_id !== myUserId ||
        message.status !== 'queued' ||
        message.optimistic ||
        String(message.id).startsWith('temp-') ||
        renderDispatchRef.current.has(message.id)
      ) {
        continue
      }

      renderDispatchRef.current.add(message.id)

      supabase.functions
        .invoke('comicchat-render', {
          body: { messageId: message.id },
        })
        .then(({ error: renderError }) => {
          if (cancelled) return
          if (renderError) {
            renderDispatchRef.current.delete(message.id)
            setError(
              'Message was sent, but comic rendering could not be started. The text is safe and can be rendered later.'
            )
          }
        })
        .catch(() => {
          if (cancelled) return
          renderDispatchRef.current.delete(message.id)
          setError(
            'Message was sent, but comic rendering could not be started. The text is safe and can be rendered later.'
          )
        })
    }

    return () => {
      cancelled = true
    }
  }, [betaSafety?.external_generation_enabled, messages, myUserId, supabase])

  useEffect(() => {
    const trimmed = query.trim()

    if (deletionPending || trimmed.length < 2) return undefined

    let cancelled = false

    const timer = setTimeout(async () => {
      const { data, error: searchError } = await supabase.rpc('comic_search_users', {
        p_query: trimmed,
      })

      if (cancelled) return

      if (searchError) {
        console.error('comic_search_users failed', searchError)
        setSearchResults([])
        return
      }

      setSearchResults(data || [])
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [deletionPending, query, supabase])

  const openConversationWith = useCallback(async (partnerId) => {
    if (deletionPending) return

    setError('')
    setBusy(true)

    try {
      const { data: conversationId, error: ensureError } = await supabase.rpc(
        'comic_ensure_direct_conversation',
        { partner_id: partnerId }
      )

      if (ensureError) throw ensureError

      const rows = await loadConversations()
      const row =
        rows.find((conversation) => conversation.conversation_id === conversationId) || {
          conversation_id: conversationId,
          other_user_id: partnerId,
          other_username: null,
          last_message_text: null,
          last_message_status: null,
          last_message_time: new Date().toISOString(),
          unread_count: 0,
        }

      setSelectedConversation(row)
      setQuery('')
      setSearchResults([])
    } catch (openError) {
      console.error('comic_ensure_direct_conversation failed', openError)
      setError('Unable to open this private conversation.')
    } finally {
      setBusy(false)
    }
  }, [deletionPending, loadConversations, supabase])

  useImperativeHandle(
    forwardedRef,
    () => ({
      openThreadWith: openConversationWith,
    }),
    [openConversationWith]
  )

  const toggleBlock = async () => {
    if (!selectedPartnerId || busy) return

    if (
      !selectedBlockedByMe &&
      typeof window !== 'undefined' &&
      !window.confirm(
        `Block ${selectedTitle}? Existing history stays visible, but neither side can send new ComicChat messages until you unblock them.`
      )
    ) {
      return
    }

    setError('')
    setBusy(true)

    try {
      const rpcName = selectedBlockedByMe ? 'comic_unblock_user' : 'comic_block_user'
      const { error: blockError } = await supabase.rpc(rpcName, {
        p_user_id: selectedPartnerId,
      })
      if (blockError) throw blockError

      await loadBlockedUsers()
      setSearchResults([])
    } catch (blockError) {
      console.error('ComicChat block state update failed', blockError)
      setError(
        selectedBlockedByMe
          ? 'Unable to unblock this user.'
          : 'Unable to block this user.'
      )
    } finally {
      setBusy(false)
    }
  }

  const openReport = (messageId) => {
    setReportTargetId(messageId)
    setReportReason('other')
    setReportDetails('')
    setReportRequestId(makeUuid())
    setReportStatus('')
  }

  const cancelReport = () => {
    if (reportBusy) return
    setReportTargetId(null)
    setReportDetails('')
    setReportRequestId(null)
  }

  const submitReport = async (event) => {
    event.preventDefault()
    if (!reportTargetId || reportBusy) return

    const requestId = reportRequestId || makeUuid()
    if (!reportRequestId) setReportRequestId(requestId)

    setReportBusy(true)
    setReportStatus('')

    try {
      const { data, error: reportError } = await supabase.rpc('comic_report_message', {
        p_message_id: reportTargetId,
        p_client_nonce: requestId,
        p_reason: reportReason,
        p_details: reportDetails.trim() || null,
      })
      if (reportError) throw reportError

      const row = Array.isArray(data) ? data[0] : data
      if (!row?.id) throw new Error('comic_report_message returned no report')

      setReportStatus('Report submitted. The other user cannot see your report through ComicChat.')
      setReportTargetId(null)
      setReportDetails('')
      setReportRequestId(null)
    } catch (reportError) {
      console.error('comic_report_message failed', reportError)
      setReportStatus('Report was not submitted. You can retry without creating a duplicate.')
    } finally {
      setReportBusy(false)
    }
  }

  const exportMyData = async () => {
    if (exportBusy) return

    setError('')
    setExportStatus('')
    setExportBusy(true)

    try {
      const { data, error: exportError } = await supabase.rpc('comic_export_my_data')
      if (exportError) throw exportError
      if (!data || typeof document === 'undefined') {
        throw new Error('comic_export_my_data returned no export')
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `comicchat-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
      setExportStatus('Your ComicChat export was downloaded as JSON.')
    } catch (exportError) {
      console.error('comic_export_my_data failed', exportError)
      setError('Unable to export your ComicChat data.')
    } finally {
      setExportBusy(false)
    }
  }

  const requestAccountDeletion = async () => {
    if (accountStateBusy || deletionPending) return

    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Request ComicChat account deletion? New chat interaction will stop immediately, but shared conversation history is retained. This request can be cancelled; hard deletion is not enabled yet.'
      )
    ) {
      return
    }

    setError('')
    setAccountStateBusy(true)

    try {
      const { data, error: requestError } = await supabase.rpc(
        'comic_request_account_deletion'
      )
      if (requestError) throw requestError

      const row = Array.isArray(data) ? data[0] : data
      setAccountState(row || {
        status: 'deletion_requested',
        deletion_requested_at: new Date().toISOString(),
        hard_delete_enabled: false,
      })
      setQuery('')
      setSearchResults([])
      setDraft('')
    } catch (requestError) {
      console.error('comic_request_account_deletion failed', requestError)
      setError('Unable to request account deletion.')
    } finally {
      setAccountStateBusy(false)
    }
  }

  const cancelAccountDeletion = async () => {
    if (accountStateBusy || !deletionPending) return

    setError('')
    setAccountStateBusy(true)

    try {
      const { data, error: cancelError } = await supabase.rpc(
        'comic_cancel_account_deletion'
      )
      if (cancelError) throw cancelError

      const row = Array.isArray(data) ? data[0] : data
      setAccountState(row || {
        status: 'active',
        deletion_requested_at: null,
        hard_delete_enabled: false,
      })
    } catch (cancelError) {
      console.error('comic_cancel_account_deletion failed', cancelError)
      setError('Unable to cancel the deletion request.')
    } finally {
      setAccountStateBusy(false)
    }
  }

  const send = async (event) => {
    event.preventDefault()

    const originalText = draft
    if (
      !selectedConversationId ||
      !originalText.trim() ||
      busy ||
      deletionPending ||
      selectedBlockedByMe
    ) return

    const conversationId = selectedConversationId
    const attempt = reusableSendAttempt(sendAttemptRef.current.get(conversationId), conversationId, originalText)
    sendAttemptRef.current.set(conversationId, attempt)
    const clientNonce = attempt.nonce
    const tempId = `temp-${clientNonce}`
    const optimistic = {
      id: tempId,
      conversation_id: selectedConversationId,
      sender_id: myUserId,
      client_nonce: clientNonce,
      original_text: originalText,
      status: 'queued',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      optimistic: true,
    }

    setError('')
    setBusy(true)
    setDraft('')
    messageScroll.followEnd()
    setMessages((current) => mergeMessage(current, optimistic))

    try {
      const { data, error: sendError } = await supabase.rpc('comic_send_message', {
        p_conversation_id: conversationId,
        p_client_nonce: clientNonce,
        p_original_text: originalText,
      })

      if (sendError) throw sendError

      const row = Array.isArray(data) ? data[0] : data
      if (!row?.id) throw new Error('comic_send_message returned no message')

      if (sendAttemptRef.current.get(conversationId) === attempt) sendAttemptRef.current.delete(conversationId)
      if (selectedConversationRef.current?.conversation_id === conversationId) {
        setMessages((current) => mergeMessage(current, row))
      }
      loadConversations().catch((loadError) => console.error('Conversation refresh failed', loadError))
    } catch (sendError) {
      console.error('comic_send_message failed', sendError)
      setMessages((current) => current.filter((message) => message.id !== tempId))
      setDraft((current) => current || originalText)
      const serverMessage = String(sendError?.message || '')
      const blocked = serverMessage.includes('interaction_blocked')
      const rateLimited = serverMessage.includes('send_rate_limited')
      const deletionRequested = serverMessage.includes('account_deletion_pending')
      const accountUnavailable = serverMessage.includes('account_unavailable')
      setError(
        deletionRequested
          ? 'Your deletion request makes ComicChat read-only. Cancel it before sending new messages.'
          : accountUnavailable
            ? 'This account is unavailable for new ComicChat messages.'
            : blocked
              ? 'New messages are blocked for this conversation. Your text is still in the composer.'
              : rateLimited
                ? 'Too many messages were sent recently. Try again shortly; your text is still in the composer.'
                : t.sendUnconfirmed
      )
    } finally {
      setBusy(false)
    }
  }

  const visibleSearchResults = query.trim().length >= 2 ? searchResults : []

  const selectedTitle = selectedConversation
    ? selectedConversation.other_username || t.privateConversation
    : t.privateComics

  return (
<section className={`${styles.shell} ${selectedConversation ? styles.hasChat : ''}`} aria-label={t.privateMessages} data-testid="comic-private-shell">
      <aside className={styles.sidebar}>
        <header className={styles.sidebarHeader}>
          <div>
            <p className={styles.eyebrow}>{t.storyDesk}</p>
            <h2>{t.privateConversations}</h2>
          </div>
          <span className={styles.lockBadge}>✦ {t.private}</span>
        </header>

        <label className={styles.searchLabel}>
          Find a user by username
          <input
            className={styles.searchInput}
            data-testid="comic-user-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              deletionPending ? 'Search disabled while deletion is requested' : t.typeTwoCharacters
            }
            autoComplete="off"
            disabled={deletionPending}
          />
        </label>

        <details className={styles.exportActions}><summary>{t.betaSettings}</summary>
          <button
            type="button"
            className={styles.safetyButton}
            onClick={exportMyData}
            disabled={exportBusy}
          >
            {exportBusy ? t.preparingExport : t.exportMyData}
          </button>
          {deletionPending ? (
            <button
              type="button"
              className={styles.safetyButton}
              onClick={cancelAccountDeletion}
              disabled={accountStateBusy}
            >
              {accountStateBusy ? t.updating : t.cancelDeletion}
            </button>
          ) : (
            <button
              type="button"
              className={styles.safetyButton}
              onClick={requestAccountDeletion}
              disabled={accountStateBusy}
            >
              {accountStateBusy ? t.updating : t.requestDeletion}
            </button>
          )}
          {exportStatus && (
            <p className={styles.exportStatus} role="status">
              {exportStatus}
            </p>
          )}
          {deletionPending && (
            <p className={styles.accountNotice} role="status">
              Deletion requested. Existing history and data export remain available, but new chat interaction is disabled. Hard deletion is not enabled yet.
            </p>
          )}
          {betaSafety && (
            <div className={styles.accountNotice} aria-label="Closed beta limits">
              <strong>Closed beta limits</strong>
              <br />
              Generation provider: {betaSafety.generation_provider || 'unknown'}.
              {' '}External generation: {betaSafety.external_generation_enabled ? 'enabled' : 'disabled'}.
              {' '}Media storage: {betaSafety.media_storage_enabled ? 'enabled' : 'disabled'}.
              {' '}Public publication: {betaSafety.public_publication_enabled ? 'enabled' : 'disabled'}.
              {' '}Hard deletion: {betaSafety.hard_delete_enabled ? 'enabled' : 'disabled'}.
              {' '}Automated purge: {betaSafety.automated_retention_purge_enabled ? 'enabled' : 'disabled'}.
              {' '}Retention duration {betaSafety.retention_duration_defined ? 'is defined' : 'is not defined'}.
            </div>
          )}
        </details>

        {visibleSearchResults.length > 0 && (
          <div className={styles.searchResults}>
            {visibleSearchResults.map((user) => (
              <button
                type="button"
                key={user.user_id}
                data-testid="comic-search-result"
                data-user-id={user.user_id}
                className={styles.searchResult}
                onClick={() => openConversationWith(user.user_id)}
                disabled={busy || deletionPending}
              >
                <span className={styles.avatar}>
                  {(user.username || '?').slice(0, 1).toUpperCase()}
                </span>
                <span>{user.username || t.unnamedUser}</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.conversationList}>
          {conversations.length === 0 ? (
            <p className={styles.emptySidebar}>
              {t.startPrivateConversation}
            </p>
          ) : (
            conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.conversation_id}
                data-testid="comic-conversation"
                data-partner-id={conversation.other_user_id}
                className={
                  conversation.conversation_id === selectedConversationId
                    ? `${styles.conversationButton} ${styles.activeConversation}`
                    : styles.conversationButton
                }
                onClick={() => {
                  setSelectedConversation(conversation)
                }}
              >
                <span className={styles.avatar}>
                  {(conversation.other_username || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className={styles.conversationCopy}>
                  <strong>{conversation.other_username || t.privateUser}</strong>
                  <span>
                    {conversation.last_message_text || t.noMessagesYet}
                  </span>
                </span>
                {Number(conversation.unread_count) > 0 && (
                  <span className={styles.unreadBadge}>
                    {conversation.unread_count}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      <div className={styles.chat}>
        <header className={styles.chatHeader}>
          {selectedConversation && <button type="button" className={styles.backButton}
            data-testid="comic-back" onClick={() => setSelectedConversation(null)}>
            ← {t.backToChats}
          </button>}
          <div>
            <p className={styles.eyebrow}>{t.yourStory}</p>
            <h2 data-testid="comic-chat-title">{selectedTitle}</h2>
          </div>
          <div className={styles.chatHeaderActions}>
            {selectedConversation && (
              <button
                type="button"
                className={
                  selectedBlockedByMe
                    ? `${styles.safetyButton} ${styles.safetyButtonActive}`
                    : styles.safetyButton
                }
                onClick={toggleBlock}
                disabled={busy}
                aria-pressed={selectedBlockedByMe}
              >
                {selectedBlockedByMe ? t.unblock : t.block}
              </button>
            )}
            <span className={styles.connection} data-testid="comic-connection">
              {connectionState === 'connected' ? t.live : connectionState}
            </span>
          </div>
        </header>

        {!selectedConversation ? (
          <ComicWelcome onOpenProfile={onOpenProfile} />
        ) : (
          <>
            <details className={styles.storyStudio} name="comic-studios">
              <summary>{t.makeComic}</summary>
              <ComicStoryPermissions
                key={selectedConversationId}
                supabase={supabase}
                conversationId={selectedConversationId}
                myUserId={myUserId}
                messages={messages}
                deletionPending={deletionPending}
                blocked={selectedBlockedByMe}
              />
            </details>

            <ComicStylePicker key={selectedConversationId}
              current={chatStyles.current} onSave={chatStyles.save}
              pending={chatStyles.pending} error={chatStyles.error}
              notice={chatStyles.notice} externalGenerationEnabled={Boolean(betaSafety?.external_generation_enabled)} />

            <div className={styles.messages} ref={messagesRef} onScroll={messageScroll.onScroll}
              aria-live="polite" data-testid="comic-messages">
              {history.error && <p role="alert" className={styles.error}>{t[history.error] || history.error}</p>}
              {history.hasOlder && <button type="button" className={styles.loadOlder}
                onClick={history.loadOlder} disabled={history.loadingOlder}>
                {history.loadingOlder ? t.loading : t.loadEarlierMessages}
              </button>}
              {messages.length === 0 && (
                <div className={styles.emptyChat}>
                  <div className={styles.placeholderPanel}>✦</div>
                  <h3>{t.startConversation}</h3>
                  <p>
                    {t.firstPanelHelp}
                  </p>
                </div>
              )}

              {messages.map((message) => {
                const mine = message.sender_id === myUserId

                return (
                  <ComicPanel
                    key={message.id}
                    messageId={message.id}
                    conversationId={message.conversation_id}
                    senderId={message.sender_id}
                    styleConfig={String(message.id).startsWith('temp-')
                      ? chatStyles.current
                      : Object.hasOwn(chatStyles.snapshots, message.id)
                        ? chatStyles.snapshots[message.id] : null}
                    speaker={mine ? t.you : selectedTitle}
                    text={message.original_text}
                    status={message.status}
                    mine={mine}
                    optimistic={message.optimistic}
                    createdAt={message.created_at}
                    onReport={mine ? null : openReport}
                    reporting={reportBusy && reportTargetId === message.id}
                    supabase={supabase}
                    mediaStorageEnabled={Boolean(betaSafety?.media_storage_enabled)}
                    mediaAssetId={message.media_asset_id || null}
                  />
                )
              })}
            </div>

            {reportTargetId && (
              <form
                className={styles.reportDialog}
                onSubmit={submitReport}
                role="dialog"
                aria-modal="false"
                aria-labelledby="comic-report-title"
              >
                <div className={styles.reportHeader}>
                  <div>
                    <p className={styles.eyebrow}>Private safety report</p>
                    <h3 id="comic-report-title">Report this message</h3>
                  </div>
                  <button
                    type="button"
                    className={styles.comicAction}
                    onClick={cancelReport}
                    disabled={reportBusy}
                  >
                    Cancel
                  </button>
                </div>

                <label className={styles.reportField}>
                  Reason
                  <select
                    className={styles.reportSelect}
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                    disabled={reportBusy}
                  >
                    {REPORT_REASONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.reportField}>
                  Optional details
                  <textarea
                    className={styles.reportTextarea}
                    value={reportDetails}
                    onChange={(event) => setReportDetails(event.target.value.slice(0, 1000))}
                    rows={3}
                    maxLength={1000}
                    disabled={reportBusy}
                    placeholder="Add context for the safety review"
                  />
                </label>

                <div className={styles.reportFooter}>
                  <span>{reportDetails.length}/1000</span>
                  <button
                    type="submit"
                    className={styles.sendButton}
                    disabled={reportBusy}
                  >
                    {reportBusy ? 'Submitting…' : 'Submit report'}
                  </button>
                </div>
              </form>
            )}

            {reportStatus && (
              <p className={styles.reportStatus} role="status">
                {reportStatus}
              </p>
            )}

            <form className={styles.composer} onSubmit={send}>
              {error && <p className={styles.error}>{error}</p>}
              {deletionPending && (
                <p className={styles.safetyNotice} role="status">
                  Account deletion is requested. Existing history stays visible, but ComicChat is read-only until you cancel the request.
                </p>
              )}
              {selectedBlockedByMe && (
                <p className={styles.safetyNotice} role="status">
                  You blocked {selectedTitle}. Existing history stays visible. Unblock this user to resume messaging.
                </p>
              )}
              {betaSafety?.external_generation_enabled && (
                <p className={styles.accountNotice} role="status">
                  Comic rendering is enabled for this closed beta. The exact message text is sent to the configured OpenAI image provider as private scene context; generated bytes are stored in private Supabase Storage. ComicChat overlays your exact text separately and does not charge your ChatGPT plan.
                </p>
              )}

              {draft.length > 0 && (
                <details className={styles.composerPreview} aria-label={t.messagePreview}>
                  <summary>{t.messagePreview}</summary>
                  <ComicPanel
                    messageId={`draft:${selectedConversationId}`}
                    senderId={myUserId}
                    styleConfig={chatStyles.current}
                    speaker={t.you}
                    text={draft}
                    status="queued"
                    mine
                    preview
                  />
                </details>
              )}

              <div className={styles.composerRow}>
                <textarea
                  className={styles.textarea}
                  data-testid="comic-composer"
                  aria-label={t.writeMessage}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, 4000))}
                  placeholder={
                    deletionPending
                      ? 'Cancel the deletion request to send messages'
                      : selectedBlockedByMe
                        ? 'Unblock this user to send a message'
                        : t.writeMessage
                  }
                  rows={2}
                  disabled={busy || deletionPending || selectedBlockedByMe}
                />
                <button
                  className={styles.sendButton}
                  data-testid="comic-send"
                  type="submit"
                  disabled={busy || deletionPending || selectedBlockedByMe || !draft.trim()}
                >
                  {busy ? t.sending : t.send}
                </button>
              </div>
              <div className={styles.composerNote}>
                <span>{draft.length}/4000</span>
                <span>{t.panelPerMessage}</span>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  )
}

export default ComicDirectMessages
