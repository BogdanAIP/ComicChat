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
  const textMessagesRef = useRef(null)
  const { t } = useTranslation()

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
  const [textOpen, setTextOpen] = useState(false)
  const [accountState, setAccountState] = useState({
    status: 'active',
    deletion_requested_at: null,
    hard_delete_enabled: false,
  })
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
      setError(t.searchLoadFailed)
      return []
    }

    const rows = data || []
    setConversations(rows)

    const currentId = selectedConversationRef.current?.conversation_id || supabase.initialConversationId
    if (currentId) {
      const fresh = rows.find((row) => row.conversation_id === currentId)
      if (fresh) setSelectedConversation(fresh)
    }

    return rows
  }, [supabase, t.searchLoadFailed])

  const loadBlockedUsers = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('comic_list_blocked_users')

    if (rpcError) {
      console.error('comic_list_blocked_users failed', rpcError)
      setError(t.actionFailed)
      return []
    }

    const ids = (data || []).map((row) => row.blocked_user_id)
    setBlockedUserIds(ids)
    return ids
  }, [supabase, t.actionFailed])

  const loadAccountState = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('comic_get_my_account_state')

    if (rpcError) {
      console.error('comic_get_my_account_state failed', rpcError)
      setError(t.actionFailed)
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
  }, [supabase, t.actionFailed])

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

    if (supabase.transport === 'mcp') {
      const refresh = () => { if (!document.hidden) loadConversations() }
      const timer = setInterval(refresh, 5000)
      document.addEventListener('visibilitychange', refresh)
      return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
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
  const { messages, setMessages } = history
  const chatStyles = useComicChatStyles(supabase, selectedConversationId, messages)
  useEffect(() => { styleRefreshRef.current = chatStyles.refresh }, [chatStyles.refresh])
  const messageScroll = useComicScroll(messagesRef, selectedConversationId, messages)
  const textScroll = useComicScroll(textMessagesRef, selectedConversationId, messages, textOpen)

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
      setError(t.actionFailed)
    } finally {
      setBusy(false)
    }
  }, [deletionPending, loadConversations, supabase, t.actionFailed])

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
        t.blockConfirm
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

      setReportStatus(t.reportSubmitted)
      setReportTargetId(null)
      setReportDetails('')
      setReportRequestId(null)
    } catch (reportError) {
      console.error('comic_report_message failed', reportError)
      setReportStatus(t.reportFailed)
    } finally {
      setReportBusy(false)
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
    textScroll.followEnd()
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
          ? t.deletionReadOnly
          : accountUnavailable
            ? t.searchDisabled
            : blocked
              ? t.blockedNotice
              : rateLimited
                ? t.sendUnconfirmed
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

            <h2>{t.privateConversations}</h2>
          </div>
          <span className={styles.lockBadge}>✦ {t.private}</span>
        </header>

        <label className={styles.searchLabel}>
          {t.typeTwoCharacters}
          <input
            className={styles.searchInput}
            data-testid="comic-user-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              deletionPending ? t.searchDisabled : t.typeTwoCharacters
            }
            autoComplete="off"
            disabled={deletionPending}
          />
        </label>

        {query.trim().length >= 2 && visibleSearchResults.length === 0 && !busy && <p className={styles.emptySidebar}>{t.noSearchResults}</p>}
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
            <span className={styles.srOnly} data-testid="comic-connection" role="status">{history.connectionState === 'connected' ? t.live : t.loading}</span>
            {selectedConversation && <button type="button" className={styles.safetyButton}
              data-testid="text-chat-toggle" aria-expanded={textOpen} aria-controls="comic-text-chat"
              onClick={() => setTextOpen(!textOpen)}>{textOpen ? t.closeText : t.textChat}</button>}
          </div>
        </header>

        {!selectedConversation ? (
          <div className={styles.emptyChat}><span className={styles.placeholderPanel} aria-hidden="true">✦</span><h3>{t.chatWelcome}</h3><p>{t.chatWelcomeHelp}</p><button type="button" className={styles.safetyButton} onClick={onOpenProfile}>{t.editName}</button></div>
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

            <div className={`${styles.conversationBody} ${textOpen ? styles.textOpen : ''}`}>
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
                    allowChatGptArt
                    onArtAttached={async () => { const { data } = await supabase.rpc('comic_read_message', { p_message_id: message.id }); const row = Array.isArray(data) ? data[0] : data; if(row && selectedConversationRef.current?.conversation_id === row.conversation_id) setMessages(current => mergeMessage(current, row)) }}
                  />
                )
              })}
            </div>

            {textOpen && <aside className={styles.textDrawer} id="comic-text-chat" aria-label={t.textChat} data-testid="text-chat">
              <header><h3>{t.textChat}</h3><button type="button" className={styles.comicAction} onClick={() => setTextOpen(false)} aria-label={t.closeText}>×</button></header>
              <div className={styles.textMessages} ref={textMessagesRef} onScroll={textScroll.onScroll}>
                {history.hasOlder && <button type="button" className={styles.loadOlder} onClick={history.loadOlder} disabled={history.loadingOlder}>{t.loadEarlierMessages}</button>}
                {messages.map(message => <article key={message.id} data-text-message-id={message.id} className={message.sender_id === myUserId ? styles.textMine : styles.textIncoming}>
                  <strong>{message.sender_id === myUserId ? t.you : selectedTitle}</strong>
                  <p dir="auto">{message.original_text}</p>
                  <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</time>
                </article>)}
              </div>
            </aside>}
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

                    <h3 id="comic-report-title">{t.reportHeading}</h3>
                  </div>
                  <button
                    type="button"
                    className={styles.comicAction}
                    onClick={cancelReport}
                    disabled={reportBusy}
                  >
                    {t.cancel}
                  </button>
                </div>

                <label className={styles.reportField}>
                  {t.reportReason}
                  <select
                    className={styles.reportSelect}
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                    disabled={reportBusy}
                  >
                    {REPORT_REASONS.map(([value]) => (
                      <option key={value} value={value}>
                        {t['report_' + value]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.reportField}>
                  {t.reportDetails}
                  <textarea
                    className={styles.reportTextarea}
                    value={reportDetails}
                    onChange={(event) => setReportDetails(event.target.value.slice(0, 1000))}
                    rows={3}
                    maxLength={1000}
                    disabled={reportBusy}
                    placeholder={t.reportDetails}
                  />
                </label>

                <div className={styles.reportFooter}>
                  <span>{reportDetails.length}/1000</span>
                  <button
                    type="submit"
                    className={styles.sendButton}
                    disabled={reportBusy}
                  >
                    {reportBusy ? t.sending : t.reportSubmit}
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
                  {t.deletionReadOnly}
                </p>
              )}
              {selectedBlockedByMe && (
                <p className={styles.safetyNotice} role="status">
                  {t.blockedNotice}
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
                      ? t.deletionReadOnly
                      : selectedBlockedByMe
                        ? t.blockedNotice
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
