import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ComicPanel from './ComicPanel'
import ComicStylePicker from './ComicStylePicker'
import useComicChatStyles from '../utils/useComicChatStyles'
import useComicMessages from '../utils/useComicMessages'
import useComicScroll from '../utils/useComicScroll'
import useConversationDraft from '../utils/useConversationDraft'
import { makeUuid, mergeMessage, reusableSendAttempt } from '../utils/comicMessages.mjs'
import useTranslation from '../utils/useTranslation'
import ComicGroupStoryStudio from './ComicGroupStoryStudio'
import styles from '../styles/ComicGroupChat.module.css'

export default function ComicGroupChat({ session, supabase }) {
  const [groups, setGroups] = useState([])
  const [invitations, setInvitations] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useConversationDraft(selectedId)
  const [members, setMembers] = useState([])
  const [groupTitle, setGroupTitle] = useState('')
  const [groupVisibility, setGroupVisibility] = useState('closed')
  const [joinId, setJoinId] = useState('')
  const [joinAccepted, setJoinAccepted] = useState(false)
  const [search, setSearch] = useState('')
  const [foundUsers, setFoundUsers] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reporting, setReporting] = useState(null)
  const [reportDetails, setReportDetails] = useState('')

  const myId = session.user.id
  const { t } = useTranslation()
  const sendAttemptRef = useRef(new Map())
  const selectedRef = useRef(selectedId)
  const styleRefreshRef = useRef(null)
  const messagesRef = useRef(null)
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])
  const [betaSafety, setBetaSafety] = useState(null)
  const history = useComicMessages({ supabase, session, conversationId: selectedId,
    onStyleChange: () => styleRefreshRef.current?.(),
  })
  const { messages, setMessages } = history
  const chatStyles = useComicChatStyles(supabase, selectedId, messages)
  useEffect(() => { styleRefreshRef.current = chatStyles.refresh }, [chatStyles.refresh])
  const messageScroll = useComicScroll(messagesRef, selectedId, messages)
  const selectedGroup = groups.find((g) => g.conversation_id === selectedId) || null
  const nameById = useMemo(
    () => new Map(members.map((m) => [m.user_id, m.username])),
    [members]
  )

  const refreshGroups = useCallback(async () => {
    const [groupsResult, inviteResult] = await Promise.all([
      supabase.rpc('comic_list_groups'),
      supabase.rpc('comic_list_group_invitations'),
    ])
    if (groupsResult.error || inviteResult.error) {
      setError(t.groupsLoadFailed)
      return
    }
    setGroups(groupsResult.data || [])
    setInvitations(inviteResult.data || [])
  }, [supabase, t.groupsLoadFailed])

  useEffect(() => {
    let live = true
    const initialLoad = async () => {
      const [g, i] = await Promise.all([
        supabase.rpc('comic_list_groups'),
        supabase.rpc('comic_list_group_invitations'),
      ])
      if (!live) return
      if (g.error || i.error) setError(t.groupsLoadFailed)
      else {
        setGroups(g.data || [])
        setInvitations(i.data || [])
      }
    }
    initialLoad()
    return () => { live = false }
  }, [supabase, t.groupsLoadFailed])

  useEffect(() => {
    let active = true
    supabase.rpc('comic_get_beta_safety_status').then(({ data }) => {
      if (active) setBetaSafety(Array.isArray(data) ? data[0] : data)
    })
    return () => { active = false }
  }, [supabase])

  useEffect(() => {
    if (!selectedId) return undefined
    let active = true
    supabase.rpc('comic_list_group_members', { p_group_id: selectedId }).then(({ data, error: rpcError }) => {
      if (!active) return
      if (rpcError) setError(t.groupLoadFailed)
      else setMembers(data || [])
    })
    return () => { active = false }
  }, [selectedId, supabase, t.groupLoadFailed])

  const perform = async (operation, success, after = null) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data, error: actionError } = await operation()
      if (actionError) throw actionError
      setNotice(success)
      await refreshGroups()
      if (after) after(data)
    } catch (e) {
      console.error('Group action failed', e)
      setError(t.groupActionFailed)
    } finally {
      setBusy(false)
    }
  }

  const createGroup = (event) => {
    event.preventDefault()
    if (!groupTitle.trim()) return
    perform(
      () => supabase.rpc('comic_create_group', {
        p_title: groupTitle.trim(), p_visibility: groupVisibility,
      }),
      t.groupCreated,
      (id) => { setSelectedId(id); setGroupTitle('') }
    )
  }

  const joinGroup = (event) => {
    event.preventDefault()
    if (!joinId.trim()) return
    perform(
      () => supabase.rpc('comic_join_group', {
        p_group_id: joinId.trim(),
        p_accept_public_reuse: joinAccepted,
      }),
      t.groupJoined,
      (id) => { setSelectedId(id); setJoinId(''); setJoinAccepted(false) }
    )
  }

  useEffect(() => {
    const query = search.trim()
    if (query.length < 2) return undefined
    let live = true
    const searchUsers = async () => {
      const { data } = await supabase.rpc('comic_search_users', { p_query: query })
      if (live) setFoundUsers(data || [])
    }
    searchUsers()
    return () => { live = false }
  }, [search, supabase])

  const send = async (event) => {
    event.preventDefault()
    const originalText = draft
    if (!selectedId || !originalText.trim() || busy) return
    const conversationId = selectedId
    const attempt = reusableSendAttempt(sendAttemptRef.current.get(conversationId), conversationId, originalText)
    sendAttemptRef.current.set(conversationId, attempt)
    const clientNonce = attempt.nonce
    const tempId = `temp-${clientNonce}`
    const optimistic = {
      id: tempId, conversation_id: conversationId, sender_id: myId,
      client_nonce: clientNonce, original_text: originalText, status: 'queued',
      created_at: new Date().toISOString(), optimistic: true,
    }
    setBusy(true)
    setError('')
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
      if (selectedRef.current === conversationId) {
        setMessages((current) => mergeMessage(current, row))
      }
    } catch (e) {
      console.error('Group message failed', e)
      setMessages((current) => current.filter((message) => message.id !== tempId))
      setDraft((current) => current || originalText)
      if (selectedRef.current === conversationId) setError(t.sendUnconfirmed)
    } finally {
      setBusy(false)
    }
  }

  const sendReport = (event) => {
    event.preventDefault()
    if (!reporting) return
    perform(
      () => supabase.rpc('comic_report_message', {
        p_message_id: reporting,
        p_client_nonce: makeUuid(),
        p_reason: 'other',
        p_details: reportDetails.trim() || null,
      }),
      t.reportSent,
      () => { setReporting(null); setReportDetails('') }
    )
  }

  return (
    <section className={`${styles.layout} ${selectedGroup ? styles.hasChat : ''}`} aria-label={t.groupMessages} data-testid="comic-group-shell">
      <aside className={styles.sidebar}>
        <header>
          <span className={styles.eyebrow}>{t.groupStories}</span>
          <h2>{t.comicGroups}</h2>
          <p>{t.groupTimeline}</p>
        </header>

        <form onSubmit={createGroup} className={styles.form}>
          <h3>{t.createGroup}</h3>
          <label>{t.groupName}
            <input aria-label={t.newGroupName} minLength={3} maxLength={80}
              value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} />
          </label>
          <label>{t.visibility}
            <select aria-label={t.groupVisibility} value={groupVisibility}
              onChange={(e) => setGroupVisibility(e.target.value)}>
              <option value="closed">{t.closedInviteOnly}</option>
              <option value="public">{t.publicComicPublishing}</option>
            </select>
          </label>
          <button type="submit" disabled={busy || groupTitle.trim().length < 3}>{t.create}</button>
        </form>

        {invitations.length > 0 && (
          <div className={styles.invites}>
            <h3>{t.invitations}</h3>
            {invitations.map((i) => (
              <div key={i.conversation_id}>
                <strong>{i.title}</strong> · {i.invited_by_username}
                <button type="button" disabled={busy} onClick={() =>
                  perform(
                    () => supabase.rpc('comic_join_group', {
                      p_group_id: i.conversation_id,
                      p_accept_public_reuse: false,
                    }),
                    t.invitationAccepted,
                    () => setSelectedId(i.conversation_id)
                  )
                }>{t.join}</button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={joinGroup} className={styles.form}>
          <h3>{t.joinPublicGroup}</h3>
          <label>{t.groupId}
            <input aria-label={t.publicGroupId} placeholder={t.pasteGroupId}
              value={joinId} onChange={(e) => setJoinId(e.target.value)} />
          </label>
          <label className={styles.terms}>
            <input type="checkbox" checked={joinAccepted}
              onChange={(e) => setJoinAccepted(e.target.checked)} />
            <span>{t.publicJoinRule}</span>
          </label>
          <button type="submit" disabled={busy || !joinId.trim() || !joinAccepted}>{t.joinPublicGroupAction}</button>
        </form>

        <button type="button" className={styles.refreshButton}
          onClick={() => refreshGroups()} disabled={busy}>
          ↻ {t.refreshGroups}
        </button>
        <h3>{t.myGroups}</h3>
        {groups.length === 0 && <p className={styles.empty}>{t.noGroupsYet}</p>}
        <div className={styles.groupList}>
          {groups.map((g) => (
            <button key={g.conversation_id} type="button"
              data-testid="comic-group-entry"
              className={selectedId === g.conversation_id ? styles.activeGroup : styles.groupButton}
              onClick={() => { setSelectedId(g.conversation_id); setError('') }}>
              <strong>{g.title}</strong>
              <span>{g.member_count} {t.members} · {t[g.visibility] || g.visibility}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className={styles.chat}>
        {!selectedGroup ? (
          <div className={styles.emptyScreen}>
            <span aria-hidden="true">✳</span>
            <h2>{t.groupEmptyTitle}</h2>
            <p>{t.groupEmptyHelp}</p>
          </div>
        ) : (
          <>
            <header className={styles.chatHeader}>
              <button type="button" className={styles.backButton} data-testid="comic-group-back"
                onClick={() => setSelectedId(null)}>← {t.backToGroups}</button>
              <div>
                <span className={styles.eyebrow}>{t.groupIssue}</span>
                <h2>{selectedGroup.title}</h2>
                <p>{selectedGroup.member_count} {t.members} · {t[selectedGroup.visibility] || selectedGroup.visibility}</p>
              </div>
              <span className={styles.privacy}>✦ {t[selectedGroup.visibility] || selectedGroup.visibility}</span>
            </header>
            <div className={styles.memberBar}>
              {members.map((m) => <span key={m.user_id}>{m.username}{m.member_role === 'owner' ? ' ★' : ''}</span>)}
            </div>
            <details className={styles.ownerTools} name="comic-studios" data-testid="comic-group-tools">
              <summary>{t.groupDetails}</summary>
              <div className={styles.ownerActions}>
              {selectedGroup.my_role === 'owner' && selectedGroup.visibility === 'closed' && (
                <div className={styles.inviteBox}>
                  <label>{t.inviteUser}
                    <input value={search} onChange={(e) => setSearch(e.target.value)}
                      aria-label={t.findUserToInvite} placeholder={t.typeTwoLetters} />
                  </label>
                  {search.trim().length >= 2 && foundUsers
                    .filter((u) => !members.some((m) => m.user_id === u.user_id))
                    .map((u) => (
                      <button key={u.user_id} disabled={busy} type="button"
                        onClick={() => perform(
                          () => supabase.rpc('comic_invite_group_user', {
                            p_group_id: selectedId,p_user_id: u.user_id,
                          }),
                          t.invitationSent
                        )}>{t.invite} {u.username}</button>
                    ))}
                </div>
              )}
              {selectedGroup.my_role !== 'owner' && (
                <button type="button" disabled={busy} onClick={() => perform(
                  () => supabase.rpc('comic_leave_group', { p_group_id: selectedId }),
                  t.groupLeft,
                  () => { setSelectedId(null); setMessages([]) }
                )}>{t.leaveGroup}</button>
              )}
              <span className={styles.groupId}>{t.groupId}: {selectedId}</span>
            </div>
            </details>
            <ComicGroupStoryStudio
              key={selectedId}
              supabase={supabase}
              group={selectedGroup}
              messages={messages}
              myUserId={myId}
            />
            <ComicStylePicker key={selectedId} current={chatStyles.current}
              onSave={chatStyles.save} pending={chatStyles.pending}
              notice={chatStyles.notice} error={chatStyles.error}
              editable={selectedGroup.my_role === 'owner'} group
              externalGenerationEnabled={Boolean(betaSafety?.external_generation_enabled)} />

            <div className={styles.messages} ref={messagesRef} onScroll={messageScroll.onScroll}
              aria-live="polite" data-testid="comic-group-messages">
              {history.error && <p role="alert" className={styles.error}>{t[history.error] || history.error}</p>}
              {history.hasOlder && <button type="button" className={styles.loadOlder}
                onClick={history.loadOlder} disabled={history.loadingOlder}>
                {history.loadingOlder ? t.loading : t.loadEarlierMessages}
              </button>}
              {messages.length === 0 && <p className={styles.empty}>{t.firstGroupPanel}</p>}
              {messages.map((m) => (
                <ComicPanel key={m.id} messageId={m.id} conversationId={m.conversation_id}
                  senderId={m.sender_id}
                  styleConfig={String(m.id).startsWith('temp-') ? chatStyles.current
                    : Object.hasOwn(chatStyles.snapshots, m.id) ? chatStyles.snapshots[m.id] : null}
                  speaker={m.sender_id === myId ? t.you : nameById.get(m.sender_id) || t.member}
                  text={m.original_text} status={m.status} mine={m.sender_id === myId} optimistic={m.optimistic}
                  createdAt={m.created_at} supabase={supabase}
                  mediaStorageEnabled={Boolean(betaSafety?.media_storage_enabled)}
                  mediaAssetId={m.media_asset_id || null}
                  onReport={m.sender_id === myId ? null : setReporting}
                />
              ))}
            </div>
            {reporting && (
              <form onSubmit={sendReport} className={styles.reportBox}>
                <label>{t.reportComicMessage}
                  <textarea value={reportDetails} onChange={(e) => setReportDetails(e.target.value)}
                    placeholder={t.describeProblem} />
                </label>
                <button type="submit" disabled={busy}>{t.sendPrivateReport}</button>
                <button type="button" onClick={() => setReporting(null)}>{t.cancel}</button>
              </form>
            )}
            <form className={styles.composer} onSubmit={send}>
              <label className={styles.srOnly} htmlFor="comic-group-draft">{t.writeComicMessage}</label>
              <textarea id="comic-group-draft" aria-label={t.writeComicMessage}
                data-testid="comic-group-composer" placeholder={t.nextComicPanel}
                value={draft} maxLength={4000} disabled={busy} onChange={(e) => setDraft(e.target.value)} />
              <button type="submit" data-testid="comic-group-send" disabled={!draft.trim() || busy}>{busy ? t.sending : t.send} ✦</button>
            </form>
          </>
        )}
        {(error || notice) && <p className={error ? styles.error : styles.notice} role="status">{error || notice}</p>}
      </div>
    </section>
  )
}
