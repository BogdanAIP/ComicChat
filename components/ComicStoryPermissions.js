import { useCallback, useEffect, useMemo, useState } from 'react'
import styles from '../styles/ComicStoryPermissions.module.css'

function safeMessages(messages, cutoffId) {
  const cutoff = messages.find((row) => row.id === cutoffId)
  if (!cutoff) return []
  return messages
    .filter((m) =>
      !String(m.id).startsWith('temp-') &&
      (new Date(m.created_at).getTime() < new Date(cutoff.created_at).getTime() ||
        (m.created_at === cutoff.created_at && String(m.id) <= String(cutoff.id)))
    )
    .slice(-36)
}

export default function ComicStoryPermissions({
  supabase,
  conversationId,
  myUserId,
  messages,
  deletionPending = false,
  blocked = false,
}) {
  const [requests, setRequests] = useState([])
  const [cutoffId, setCutoffId] = useState('')
  const [title, setTitle] = useState('Our comic story')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const savedMessages = useMemo(
    () => messages.filter((m) => !String(m.id).startsWith('temp-')),
    [messages]
  )
  const selectedCutoffId = savedMessages.some((m) => m.id === cutoffId)
    ? cutoffId
    : savedMessages[savedMessages.length - 1]?.id || ''
  const disabled = deletionPending || blocked || busy

  const refresh = useCallback(async () => {
    if (!conversationId) return
    const { data, error } = await supabase.rpc(
      'comic_list_public_snapshot_requests',
      { p_conversation_id: conversationId }
    )
    if (error) {
      console.error('Could not load story permissions', error)
      setNotice('Unable to load comic permissions. Please try again.')
      return
    }
    setRequests(data || [])
  }, [conversationId, supabase])

  useEffect(() => {
    if (!conversationId) return undefined
    let active = true
    const update = async () => {
      if (!active) return
      await refresh()
    }
    update()
    const timer = setInterval(update, 12000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [conversationId, refresh])

  const act = async (action, success) => {
    setBusy(true)
    setNotice('')
    try {
      const { error } = await action()
      if (error) throw error
      setNotice(success)
      await refresh()
    } catch (error) {
      console.error('Comic permission action failed', error)
      setNotice('This action could not be completed. No comic was published.')
    } finally {
      setBusy(false)
    }
  }

  const askPermission = () => {
    if (!selectedCutoffId || disabled) return
    act(
      () => supabase.rpc('comic_propose_public_snapshot', {
        p_conversation_id: conversationId,
        p_through_message_id: selectedCutoffId,
      }),
      'One permission request sent. It covers making and publishing this comic.'
    )
  }

  return (
    <section className={styles.panel} aria-label="Comics from our conversation" data-testid="comic-story-permissions">
      <div className={styles.header}>
        <span className={styles.marker}>STORY STUDIO</span>
        <h3>Turn our chat into a comic</h3>
        <p>One request covers creating <strong>and</strong> publishing a comic from the selected messages. Your partner approves only once.</p>
      </div>

      {savedMessages.length > 0 && (
        <div className={styles.requestForm}>
          <label>
            Include messages through
            <select
              aria-label="Choose final message for comic"
              data-testid="comic-story-cutoff"
              value={selectedCutoffId}
              onChange={(e) => setCutoffId(e.target.value)}
              disabled={disabled}
            >
              {savedMessages.map((message) => (
                <option key={message.id} value={message.id}>
                  {message.original_text.slice(0, 55)}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.hint}>
            Up to 36 messages ending here will become comic panels. Your partner can review the exact messages before allowing publication.
          </p>
          <button
            type="button"
            data-testid="comic-story-request"
            className={styles.primaryButton}
            disabled={!selectedCutoffId || disabled}
            onClick={askPermission}
          >
            Request one permission
          </button>
        </div>
      )}

      {requests.map((request) => {
        const mine = request.requested_by === myUserId
        const approved = request.all_members_consented && request.sharing_eligible
        const included = safeMessages(savedMessages, request.through_message_id)
        return (
          <article key={request.request_id} className={styles.request} data-testid="comic-story-request-card">
            <div className={styles.requestHeading}>
              <strong>{mine ? 'Your comic request' : 'Permission requested from you'}</strong>
              <span>{approved ? 'Approved' : 'Awaiting permission'}</span>
            </div>
            <p className={styles.hint}>
              One approval grants permission to <strong>create and publish</strong> a comic based on these messages. No further confirmation will be requested for this episode.
            </p>
            <details>
              <summary>Review the included messages ({included.length} shown)</summary>
              <ol className={styles.messageReview}>
                {included.map((m) => (
                  <li key={m.id}>{m.original_text}</li>
                ))}
              </ol>
            </details>
            {!mine && !request.my_consented && (
              <div className={styles.actions}>
                <button
                  type="button"
                  data-testid="comic-story-approve"
                  disabled={disabled}
                  className={styles.primaryButton}
                  onClick={() => act(
                    () => supabase.rpc('comic_set_public_snapshot_consent', {
                      p_request_id: request.request_id,
                      p_consented: true,
                    }),
                    'Approved creation and publication with one permission.'
                  )}
                >
                  Allow making and publishing
                </button>
                <button
                  type="button"
                  data-testid="comic-story-decline"
                  className={styles.secondaryButton}
                  disabled={disabled}
                  onClick={() => act(
                    () => supabase.rpc('comic_cancel_public_snapshot_request', {
                      p_request_id: request.request_id,
                    }),
                    'Request declined.'
                  )}
                >
                  Decline
                </button>
              </div>
            )}
            {mine && approved && (
              <div className={styles.requestForm}>
                <label>
                  Story title
                  <input
                    aria-label="Comic story title"
                    value={title}
                    maxLength={100}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={disabled}
                  />
                </label>
                <button
                  type="button"
                  data-testid="comic-story-release"
                  className={styles.primaryButton}
                  disabled={disabled || !title.trim()}
                  onClick={() => act(
                    () => supabase.rpc('comic_release_approved_episode', {
                      p_request_id: request.request_id,
                      p_title: title.trim(),
                    }),
                    'Comic published! Open Stories to read it.'
                  )}
                >
                  Create and publish comic
                </button>
              </div>
            )}
            {!mine && request.my_consented && (
              <p className={styles.hint}>You gave permission for this comic. The requester can now create and publish it.</p>
            )}
          </article>
        )
      })}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
    </section>
  )
}
