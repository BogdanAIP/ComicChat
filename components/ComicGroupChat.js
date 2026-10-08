import { useCallback, useEffect, useMemo, useState } from 'react'
import ComicPanel from './ComicPanel'
import styles from '../styles/ComicGroupChat.module.css'

const PUBLIC_JOIN_RULE =
  'I understand that messages I send in this public group may be included in comics created and published by other group members in ComicChat.'

export default function ComicGroupChat({ session, supabase }) {
  const [groups, setGroups] = useState([])
  const [invitations, setInvitations] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [members, setMembers] = useState([])
  const [messages, setMessages] = useState([])
  const [groupTitle, setGroupTitle] = useState('')
  const [groupVisibility, setGroupVisibility] = useState('closed')
  const [joinId, setJoinId] = useState('')
  const [joinAccepted, setJoinAccepted] = useState(false)
  const [search, setSearch] = useState('')
  const [foundUsers, setFoundUsers] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reporting, setReporting] = useState(null)
  const [reportDetails, setReportDetails] = useState('')

  const myId = session.user.id
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
      setError('Unable to load groups and invitations.')
      return
    }
    setGroups(groupsResult.data || [])
    setInvitations(inviteResult.data || [])
  }, [supabase])

  useEffect(() => {
    let live = true
    const initialLoad = async () => {
      const [g, i] = await Promise.all([
        supabase.rpc('comic_list_groups'),
        supabase.rpc('comic_list_group_invitations'),
      ])
      if (!live) return
      if (g.error || i.error) setError('Unable to load group chats.')
      else {
        setGroups(g.data || [])
        setInvitations(i.data || [])
      }
    }
    initialLoad()
    return () => { live = false }
  }, [supabase])

  useEffect(() => {
    if (!selectedId) return undefined
    let active = true
    let channel
    const loadChat = async () => {
      const [m, p] = await Promise.all([
        supabase.rpc('comic_read_conversation_messages', {
          p_conversation_id: selectedId, p_limit: 300,
        }),
        supabase.rpc('comic_list_group_members', { p_group_id: selectedId }),
      ])
      if (!active) return
      if (m.error || p.error) {
        setError('Unable to load this group.')
        return
      }
      setMessages(m.data || [])
      setMembers(p.data || [])
    }
    const subscribe = async () => {
      await supabase.realtime.setAuth(session.access_token)
      if (!active) return
      channel = supabase.channel(`conversation:${selectedId}`, {
        config: { private: true },
      })
        .on('broadcast', { event: 'INSERT' }, loadChat)
        .on('broadcast', { event: 'UPDATE' }, loadChat)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED' && active) loadChat()
        })
      loadChat()
    }
    subscribe()
    return () => {
      active = false
      if (channel) supabase.removeChannel(channel)
    }
  }, [selectedId, session.access_token, supabase])

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
      setError('Action failed. Check group permissions and try again.')
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
      'Group created. Add members or share its group ID.',
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
      'You joined the group.',
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
    const text = draft.trim()
    if (!selectedId || !text || busy) return
    setBusy(true)
    setError('')
    try {
      const { error: sendError } = await supabase.rpc('comic_send_message', {
        p_conversation_id: selectedId,
        p_client_nonce: crypto.randomUUID(),
        p_original_text: text,
      })
      if (sendError) throw sendError
      setDraft('')
      const { data } = await supabase.rpc('comic_read_conversation_messages', {
        p_conversation_id: selectedId, p_limit: 300,
      })
      if (data) setMessages(data)
    } catch (e) {
      console.error('Group message failed', e)
      setError('Message was not sent; your draft is preserved.')
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
        p_client_nonce: crypto.randomUUID(),
        p_reason: 'other',
        p_details: reportDetails.trim() || null,
      }),
      'Report sent privately.',
      () => { setReporting(null); setReportDetails('') }
    )
  }

  return (
    <section className={styles.layout} aria-label="ComicChat group messages" data-testid="comic-group-shell">
      <aside className={styles.sidebar}>
        <header>
          <span className={styles.eyebrow}>GROUP STORIES</span>
          <h2>Comic Groups</h2>
          <p>One live timeline. Every message is a comic panel.</p>
        </header>

        <form onSubmit={createGroup} className={styles.form}>
          <h3>Create a group</h3>
          <label>Group name
            <input aria-label="New group name" minLength={3} maxLength={80}
              value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} />
          </label>
          <label>Visibility
            <select aria-label="Group visibility" value={groupVisibility}
              onChange={(e) => setGroupVisibility(e.target.value)}>
              <option value="closed">Closed — invite only</option>
              <option value="public">Public — members agree to comic publishing</option>
            </select>
          </label>
          <button type="submit" disabled={busy || groupTitle.trim().length < 3}>Create</button>
        </form>

        {invitations.length > 0 && (
          <div className={styles.invites}>
            <h3>Invitations</h3>
            {invitations.map((i) => (
              <div key={i.conversation_id}>
                <strong>{i.title}</strong> · {i.invited_by_username}
                <button type="button" disabled={busy} onClick={() =>
                  perform(
                    () => supabase.rpc('comic_join_group', {
                      p_group_id: i.conversation_id,
                      p_accept_public_reuse: false,
                    }),
                    'Invitation accepted.',
                    () => setSelectedId(i.conversation_id)
                  )
                }>Join</button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={joinGroup} className={styles.form}>
          <h3>Join a public group</h3>
          <label>Group ID
            <input aria-label="Public group ID" placeholder="Paste group ID"
              value={joinId} onChange={(e) => setJoinId(e.target.value)} />
          </label>
          <label className={styles.terms}>
            <input type="checkbox" checked={joinAccepted}
              onChange={(e) => setJoinAccepted(e.target.checked)} />
            <span>{PUBLIC_JOIN_RULE}</span>
          </label>
          <button type="submit" disabled={busy || !joinId.trim() || !joinAccepted}>Join public group</button>
        </form>

        <button type="button" className={styles.refreshButton}
          onClick={() => refreshGroups()} disabled={busy}>
          ↻ Refresh groups and invitations
        </button>
        <h3>My groups</h3>
        {groups.length === 0 && <p className={styles.empty}>No groups yet.</p>}
        <div className={styles.groupList}>
          {groups.map((g) => (
            <button key={g.conversation_id} type="button"
              data-testid="comic-group-entry"
              className={selectedId === g.conversation_id ? styles.activeGroup : styles.groupButton}
              onClick={() => { setSelectedId(g.conversation_id); setError(''); setMessages([]) }}>
              <strong>{g.title}</strong>
              <span>{g.member_count} members · {g.visibility}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className={styles.chat}>
        {!selectedGroup ? (
          <div className={styles.emptyScreen}>
            <span aria-hidden="true">✳</span>
            <h2>Every group chat is a comic.</h2>
            <p>Create a group, invite friends, and start talking in illustrated panels.</p>
          </div>
        ) : (
          <>
            <header className={styles.chatHeader}>
              <div>
                <span className={styles.eyebrow}>GROUP ISSUE</span>
                <h2>{selectedGroup.title}</h2>
                <p>{selectedGroup.member_count} members · {selectedGroup.visibility}</p>
              </div>
              <span className={styles.privacy}>✦ {selectedGroup.visibility}</span>
            </header>
            <div className={styles.memberBar}>
              {members.map((m) => <span key={m.user_id}>{m.username}{m.member_role === 'owner' ? ' ★' : ''}</span>)}
            </div>
            <div className={styles.ownerActions}>
              {selectedGroup.my_role === 'owner' && selectedGroup.visibility === 'closed' && (
                <div className={styles.inviteBox}>
                  <label>Invite a user by username
                    <input value={search} onChange={(e) => setSearch(e.target.value)}
                      aria-label="Find user to invite" placeholder="Type 2+ letters" />
                  </label>
                  {search.trim().length >= 2 && foundUsers
                    .filter((u) => !members.some((m) => m.user_id === u.user_id))
                    .map((u) => (
                      <button key={u.user_id} disabled={busy} type="button"
                        onClick={() => perform(
                          () => supabase.rpc('comic_invite_group_user', {
                            p_group_id: selectedId,p_user_id: u.user_id,
                          }),
                          'Invitation sent.'
                        )}>Invite {u.username}</button>
                    ))}
                </div>
              )}
              {selectedGroup.my_role !== 'owner' && (
                <button type="button" disabled={busy} onClick={() => perform(
                  () => supabase.rpc('comic_leave_group', { p_group_id: selectedId }),
                  'You left the group.',
                  () => { setSelectedId(null); setMessages([]) }
                )}>Leave group</button>
              )}
              <span className={styles.groupId}>Group ID: {selectedId}</span>
            </div>
            <div className={styles.messages} aria-live="polite" data-testid="comic-group-messages">
              {messages.length === 0 && <p className={styles.empty}>Write the first comic panel.</p>}
              {messages.map((m) => (
                <ComicPanel key={m.id} messageId={m.id} conversationId={m.conversation_id}
                  speaker={m.sender_id === myId ? 'You' : nameById.get(m.sender_id) || 'Member'}
                  text={m.original_text} status={m.status} mine={m.sender_id === myId}
                  createdAt={m.created_at} supabase={supabase}
                  mediaStorageEnabled={false}
                  onReport={m.sender_id === myId ? null : setReporting}
                />
              ))}
            </div>
            {reporting && (
              <form onSubmit={sendReport} className={styles.reportBox}>
                <label>Report this comic message
                  <textarea value={reportDetails} onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Describe the problem" />
                </label>
                <button type="submit" disabled={busy}>Send private report</button>
                <button type="button" onClick={() => setReporting(null)}>Cancel</button>
              </form>
            )}
            <form className={styles.composer} onSubmit={send}>
              <label className={styles.srOnly} htmlFor="comic-group-draft">Write a comic message</label>
              <textarea id="comic-group-draft" aria-label="Write a comic message"
                data-testid="comic-group-composer" placeholder="Your next comic panel..."
                value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} />
              <button type="submit" data-testid="comic-group-send" disabled={!draft.trim() || busy}>Send ✦</button>
            </form>
          </>
        )}
        {(error || notice) && <p className={error ? styles.error : styles.notice} role="status">{error || notice}</p>}
      </div>
    </section>
  )
}
