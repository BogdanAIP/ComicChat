import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import styles from '../styles/ComicDirectMessages.module.css'

function makeUuid() {
  const browserCrypto = globalThis.crypto

  if (browserCrypto?.randomUUID) {
    return browserCrypto.randomUUID()
  }

  if (!browserCrypto?.getRandomValues) {
    throw new Error('Secure random UUID generation is unavailable')
  }

  const bytes = new Uint8Array(16)
  browserCrypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

function sortMessages(messages) {
  return [...messages].sort((a, b) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    if (timeDiff !== 0) return timeDiff
    return String(a.id).localeCompare(String(b.id))
  })
}

function mergeMessage(previous, nextMessage) {
  const withoutDuplicate = previous.filter((message) => {
    if (message.id === nextMessage.id) return false
    if (
      nextMessage.client_nonce &&
      message.client_nonce === nextMessage.client_nonce &&
      message.sender_id === nextMessage.sender_id
    ) {
      return false
    }
    return true
  })

  return sortMessages([...withoutDuplicate, nextMessage])
}

const ComicDirectMessages = forwardRef(({ session, supabase }, ref) => {
  const myUserId = session?.user?.id

  if (!myUserId) return null

  return (
    <ComicDirectMessagesContent
      session={session}
      supabase={supabase}
      forwardedRef={ref}
    />
  )
})

ComicDirectMessages.displayName = 'ComicDirectMessages'

function ComicDirectMessagesContent({ session, supabase, forwardedRef }) {
  const myUserId = session.user.id
  const channelRef = useRef(null)
  const selectedConversationRef = useRef(null)
  const messagesEndRef = useRef(null)

  const [conversations, setConversations] = useState([])
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [draft, setDraft] = useState('')
  const [connectionState, setConnectionState] = useState('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selectedConversationId = selectedConversation?.conversation_id || null

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

  useEffect(() => {
    const timer = setTimeout(() => {
      loadConversations()
    }, 0)

    return () => clearTimeout(timer)
  }, [loadConversations])

  useEffect(() => {
    const channel = supabase
      .channel(`comic-memberships:${myUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'comic_membership',
          filter: `user_id=eq.${myUserId}`,
        },
        () => loadConversations()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadConversations, myUserId, supabase])

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

  useEffect(() => {
    if (!selectedConversationId) return undefined

    let cancelled = false

    const loadHistory = async () => {
      const { data, error: loadError } = await supabase
        .from('comic_message')
        .select('id, conversation_id, sender_id, client_nonce, original_text, status, created_at, updated_at')
        .eq('conversation_id', selectedConversationId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })

      if (cancelled) return

      if (loadError) {
        console.error('comic_message history load failed', loadError)
        setError('Unable to load this conversation.')
        return
      }

      setMessages((current) => {
        let merged = current.filter(
          (message) =>
            message.conversation_id === selectedConversationId &&
            String(message.id).startsWith('temp-')
        )

        for (const row of data || []) {
          merged = mergeMessage(merged, row)
        }

        return sortMessages(merged)
      })

      const visible = typeof document === 'undefined' ? false : !document.hidden
      await markReceipts(selectedConversationId, visible)
      await loadConversations()
    }

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }

    const channel = supabase
      .channel(`comic-message:${selectedConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'comic_message',
          filter: `conversation_id=eq.${selectedConversationId}`,
        },
        async (payload) => {
          if (!payload?.new?.id) return

          setMessages((current) => mergeMessage(current, payload.new))

          if (payload.new.sender_id !== myUserId) {
            const visible = typeof document === 'undefined' ? false : !document.hidden
            await markReceipts(selectedConversationId, visible)
          }

          await loadConversations()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'comic_message',
          filter: `conversation_id=eq.${selectedConversationId}`,
        },
        (payload) => {
          if (!payload?.new?.id) return
          setMessages((current) => mergeMessage(current, payload.new))
        }
      )
      .subscribe((status) => {
        if (cancelled) return
        setConnectionState(status === 'SUBSCRIBED' ? 'connected' : status.toLowerCase())
        if (status === 'SUBSCRIBED') loadHistory()
      })

    channelRef.current = channel

    return () => {
      cancelled = true
      if (channelRef.current === channel) channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [
    loadConversations,
    markReceipts,
    myUserId,
    selectedConversationId,
    supabase,
  ])

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const trimmed = query.trim()

    if (trimmed.length < 2) return undefined

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
  }, [query, supabase])

  const openConversationWith = useCallback(async (partnerId) => {
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

      setMessages([])
      setConnectionState('connecting')
      setSelectedConversation(row)
      setQuery('')
      setSearchResults([])
    } catch (openError) {
      console.error('comic_ensure_direct_conversation failed', openError)
      setError('Unable to open this private conversation.')
    } finally {
      setBusy(false)
    }
  }, [loadConversations, supabase])

  useImperativeHandle(
    forwardedRef,
    () => ({
      openThreadWith: openConversationWith,
    }),
    [openConversationWith]
  )

  const send = async (event) => {
    event.preventDefault()

    const originalText = draft
    if (!selectedConversationId || !originalText.trim() || busy) return

    const clientNonce = makeUuid()
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
    setMessages((current) => mergeMessage(current, optimistic))

    try {
      const { data, error: sendError } = await supabase.rpc('comic_send_message', {
        p_conversation_id: selectedConversationId,
        p_client_nonce: clientNonce,
        p_original_text: originalText,
      })

      if (sendError) throw sendError

      const row = Array.isArray(data) ? data[0] : data
      if (!row?.id) throw new Error('comic_send_message returned no message')

      setMessages((current) => mergeMessage(current, row))
      await loadConversations()
    } catch (sendError) {
      console.error('comic_send_message failed', sendError)
      setMessages((current) => current.filter((message) => message.id !== tempId))
      setDraft(originalText)
      setError('Message was not sent. Your text is still in the composer.')
    } finally {
      setBusy(false)
    }
  }

  const visibleSearchResults = query.trim().length >= 2 ? searchResults : []

  const selectedTitle = useMemo(() => {
    if (!selectedConversation) return 'Private comics'
    return selectedConversation.other_username || 'Private conversation'
  }, [selectedConversation])

  return (
    <section className={styles.shell} aria-label="ComicChat private messages">
      <aside className={styles.sidebar}>
        <header className={styles.sidebarHeader}>
          <div>
            <p className={styles.eyebrow}>ComicChat</p>
            <h2>Private conversations</h2>
          </div>
          <span className={styles.lockBadge}>Private</span>
        </header>

        <label className={styles.searchLabel}>
          Find a user by username
          <input
            className={styles.searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type at least 2 characters"
            autoComplete="off"
          />
        </label>

        {visibleSearchResults.length > 0 && (
          <div className={styles.searchResults}>
            {visibleSearchResults.map((user) => (
              <button
                type="button"
                key={user.user_id}
                className={styles.searchResult}
                onClick={() => openConversationWith(user.user_id)}
                disabled={busy}
              >
                <span className={styles.avatar}>
                  {(user.username || '?').slice(0, 1).toUpperCase()}
                </span>
                <span>{user.username || 'Unnamed user'}</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.conversationList}>
          {conversations.length === 0 ? (
            <p className={styles.emptySidebar}>
              Search for a username to start a private conversation.
            </p>
          ) : (
            conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.conversation_id}
                className={
                  conversation.conversation_id === selectedConversationId
                    ? `${styles.conversationButton} ${styles.activeConversation}`
                    : styles.conversationButton
                }
                onClick={() => {
                  setMessages([])
                  setConnectionState('connecting')
                  setSelectedConversation(conversation)
                }}
              >
                <span className={styles.avatar}>
                  {(conversation.other_username || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className={styles.conversationCopy}>
                  <strong>{conversation.other_username || 'Private user'}</strong>
                  <span>
                    {conversation.last_message_text || 'No messages yet'}
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
          <div>
            <p className={styles.eyebrow}>Secure text baseline</p>
            <h2>{selectedTitle}</h2>
          </div>
          <span className={styles.connection}>
            {connectionState === 'connected' ? 'Live' : connectionState}
          </span>
        </header>

        {!selectedConversation ? (
          <div className={styles.emptyChat}>
            <div className={styles.placeholderPanel}>💬</div>
            <h3>Select a private conversation</h3>
            <p>
              PR-02 uses the new membership-scoped ComicChat domain. Legacy
              direct-message tables, public attachment URLs, audio, and email
              notifications are not used here.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.messages} aria-live="polite">
              {messages.length === 0 && (
                <div className={styles.emptyChat}>
                  <div className={styles.placeholderPanel}>✦</div>
                  <h3>Start the conversation</h3>
                  <p>
                    Text is stored verbatim. Comic rendering will replace this
                    text-only baseline in later PRs without changing the message ID.
                  </p>
                </div>
              )}

              {messages.map((message) => {
                const mine = message.sender_id === myUserId

                return (
                  <article
                    key={message.id}
                    className={
                      mine
                        ? `${styles.message} ${styles.mine}`
                        : styles.message
                    }
                  >
                    <div className={styles.messageMeta}>
                      <span>{mine ? 'You' : selectedTitle}</span>
                      <span>{message.status}</span>
                    </div>
                    <p>{message.original_text}</p>
                    {message.optimistic && (
                      <span className={styles.sending}>Sending…</span>
                    )}
                  </article>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            <form className={styles.composer} onSubmit={send}>
              {error && <p className={styles.error}>{error}</p>}
              <div className={styles.composerRow}>
                <textarea
                  className={styles.textarea}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, 4000))}
                  placeholder="Write a message…"
                  rows={2}
                />
                <button
                  className={styles.sendButton}
                  type="submit"
                  disabled={busy || !draft.trim()}
                >
                  Send
                </button>
              </div>
              <div className={styles.composerNote}>
                <span>{draft.length}/4000</span>
                <span>Attachments are disabled until private signed media ships.</span>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  )
}

export default ComicDirectMessages
