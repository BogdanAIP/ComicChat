import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useTranslation from '../utils/useTranslation'
import styles from '../styles/ComicStoryPermissions.module.css'

export default function ComicStoryPermissions({ supabase, conversationId, myUserId,
  messages, deletionPending = false, blocked = false }) {
  const { t } = useTranslation()
  const [requests, setRequests] = useState([])
  const [previews, setPreviews] = useState({})
  const [cutoffId, setCutoffId] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const savedMessages = useMemo(() => messages.filter((m) => !String(m.id).startsWith('temp-')), [messages])
  const selectedCutoffId = savedMessages.some((m) => m.id === cutoffId)
    ? cutoffId : savedMessages[savedMessages.length - 1]?.id || ''
  const disabled = deletionPending || blocked || busy

  const refresh = useCallback(async () => {
    const run = generation.current
    const { data, error } = await supabase.rpc('comic_list_public_snapshot_requests', {
      p_conversation_id: conversationId,
    })
    if (run !== generation.current) return
    if (error) { setNotice(t.storyLoadError); return }
    setRequests(data || [])
  }, [conversationId, supabase, t])

  useEffect(() => {
    generation.current += 1
    const run = generation.current
    queueMicrotask(() => {
      if (run !== generation.current) return
      setRequests([])
      setPreviews({})
      setNotice('')
      setBusy(false)
    })
    if (!conversationId) return undefined
    const initial = setTimeout(refresh, 0)
    const timer = setInterval(refresh, 12000)
    return () => { generation.current += 1; clearTimeout(initial); clearInterval(timer) }
  }, [conversationId, refresh])

  const review = async (requestId) => {
    if (previews[requestId]?.loading || previews[requestId]?.panels?.length) return
    const run = generation.current
    setPreviews((current) => ({ ...current, [requestId]: { loading: true } }))
    const { data, error } = await supabase.rpc('comic_read_publication_preview', { p_request_id: requestId })
    if (run !== generation.current) return
    setPreviews((current) => ({ ...current, [requestId]: {
      panels: !error && Array.isArray(data) ? data : [], error: Boolean(error), loading: false,
    } }))
  }

  const act = async (action, success) => {
    const run = generation.current
    setBusy(true)
    setNotice('')
    try {
      const { error } = await action()
      if (error) throw error
      if (run !== generation.current) return
      setNotice(success)
      await refresh()
    } catch {
      if (run === generation.current) setNotice(t.storyActionError)
    } finally {
      if (run === generation.current) setBusy(false)
    }
  }

  return (
    <section className={styles.panel} aria-label={t.storyHeading} data-testid="comic-story-permissions">
      <div className={styles.header}>
        <span className={styles.marker}>{t.storyStudio}</span>
        <h3>{t.storyHeading}</h3><p>{t.storyPermissionExplanation}</p>
      </div>
      {savedMessages.length > 0 && <div className={styles.requestForm}>
        <label>{t.storyThrough}
          <select aria-label={t.storyChooseFinal} data-testid="comic-story-cutoff" value={selectedCutoffId}
            onChange={(e) => setCutoffId(e.target.value)} disabled={disabled}>
            {savedMessages.map((m) => <option key={m.id} value={m.id}>{m.original_text.slice(0, 55)}</option>)}
          </select>
        </label>
        <p className={styles.hint}>{t.storyBound}</p>
        <button type="button" data-testid="comic-story-request" className={styles.primaryButton}
          disabled={!selectedCutoffId || disabled} onClick={() => act(
            () => supabase.rpc('comic_propose_public_snapshot', {
              p_conversation_id: conversationId, p_through_message_id: selectedCutoffId,
            }), t.storyRequestSent)}>{t.storyRequest}</button>
      </div>}
      {requests.map((request) => {
        const mine = request.requested_by === myUserId
        const approved = request.all_members_consented && request.sharing_eligible
        const preview = previews[request.request_id]
        const canApprove = Boolean(preview?.panels?.length && !preview.error && !preview.loading)
        return <article key={request.request_id} className={styles.request} data-testid="comic-story-request-card">
          <div className={styles.requestHeading}><strong>{mine ? t.storyYourRequest : t.storyIncomingRequest}</strong>
            <span>{approved ? t.storyApproved : t.storyAwaiting}</span></div>
          <p className={styles.hint}>{t.storyPermissionExplanation}</p>
          <details onToggle={(e) => { if (e.currentTarget.open) review(request.request_id) }}>
            <summary>{t.storyReview}{preview?.panels?.length ? ` (${preview.panels.length})` : ''}</summary>
            {preview?.loading && <p role="status">{t.storyPreviewLoading}</p>}
            {preview && !preview.loading && !canApprove && <p role="alert">{t.storyPreviewError}
              <button type="button" onClick={() => review(request.request_id)}>{t.storyRefresh}</button></p>}
            {canApprove && <ol className={styles.messageReview} data-testid="comic-story-snapshot">
              {preview.panels.map((panel) => <li key={panel.id} dir="auto"><strong>{panel.speaker}: </strong>{panel.text}</li>)}
            </ol>}
          </details>
          {!mine && !request.my_consented && <div className={styles.actions}>
            {!canApprove && <p className={styles.hint}>{t.storyReviewFirst}</p>}
            <button type="button" data-testid="comic-story-approve" disabled={disabled || !canApprove}
              className={styles.primaryButton} onClick={() => act(
                () => supabase.rpc('comic_set_public_snapshot_consent', { p_request_id: request.request_id, p_consented: true }),
                t.storyApproveDone)}>{t.storyApprove}</button>
            <button type="button" data-testid="comic-story-decline" disabled={disabled}
              className={styles.secondaryButton} onClick={() => act(
                () => supabase.rpc('comic_cancel_public_snapshot_request', { p_request_id: request.request_id }),
                t.storyDeclineDone)}>{t.storyDecline}</button>
          </div>}
          {mine && approved && <div className={styles.requestForm}>
            <label>{t.storyTitle}<input aria-label={t.storyTitle} value={title} placeholder={t.storyDefaultTitle}
              maxLength={100} onChange={(e) => setTitle(e.target.value)} disabled={disabled} /></label>
            <button type="button" data-testid="comic-story-release" className={styles.primaryButton} disabled={disabled}
              onClick={() => act(() => supabase.rpc('comic_release_approved_episode', {
                p_request_id: request.request_id, p_title: title.trim() || t.storyDefaultTitle,
              }), t.storyReleased)}>{t.storyRelease}</button>
          </div>}
          {request.my_consented && <div className={styles.actions}>
            <p className={styles.hint}>{t.storyPermissionGiven}</p>
            <button type="button" data-testid="comic-story-revoke" className={styles.secondaryButton} disabled={disabled}
              onClick={() => act(() => supabase.rpc('comic_set_public_snapshot_consent', {
                p_request_id: request.request_id, p_consented: false,
              }), t.storyRevokeDone)}>{t.storyRevoke}</button>
          </div>}
        </article>
      })}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
    </section>
  )
}
