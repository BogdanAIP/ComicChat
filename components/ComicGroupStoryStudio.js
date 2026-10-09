import { useCallback, useEffect, useState } from 'react'
import ComicPanel from './ComicPanel'
import useTranslation from '../utils/useTranslation'
import styles from '../styles/ComicGroupStoryStudio.module.css'

const MAX_PANELS = 36

export default function ComicGroupStoryStudio({ supabase, group, messages, myUserId }) {
  const { t } = useTranslation()
  const [chosen, setChosen] = useState([])
  const [title, setTitle] = useState('')
  const [episodes, setEpisodes] = useState([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const groupId = group.conversation_id
  const isPublic = group.visibility === 'public' && !group.adult_theme

  const loadEpisodes = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('comic_list_group_episodes', {
      p_group_id: groupId,
      p_limit: 30,
    })
    if (loadError) throw loadError
    setEpisodes(data || [])
  }, [groupId, supabase])

  useEffect(() => {
    let active = true
    const start = async () => {
      const { data, error: loadError } = await supabase.rpc('comic_list_group_episodes', {
        p_group_id: groupId,
        p_limit: 30,
      })
      if (!active) return
      if (loadError) {
        setError(t.groupStoryLoadError)
      } else {
        setEpisodes(data || [])
      }
    }
    start()
    return () => { active = false }
  }, [groupId, supabase, t])

  const toggle = (id) => {
    setChosen((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < MAX_PANELS ? [...current, id] : current
    )
  }

  const perform = async (request, success) => {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const { error: operationError } = await request()
      if (operationError) throw operationError
      await loadEpisodes()
      setStatus(success)
      return true
    } catch (e) {
      console.error('Comic group story operation failed', e)
      setError(t.groupStoryActionError)
      return false
    } finally {
      setBusy(false)
    }
  }

  const makeEpisode = async (event) => {
    event.preventDefault()
    if (!chosen.length) return
    const selected = messages.filter((m) => chosen.includes(m.id))
    if (selected.length !== chosen.length) {
      setError(t.groupStoryChanged)
      return
    }
    const ok = await perform(
      () => supabase.rpc('comic_compile_group_episode', {
        p_group_id: groupId,
        p_message_ids: selected.map((m) => m.id),
        p_title: title.trim() || t.groupStoryDefault,
      }),
      isPublic
        ? t.groupStoryCreated
        : t.groupStoryClosedCreated
    )
    if (ok) setChosen([])
  }

  return (
    <details name="comic-studios" className={styles.studio} data-testid="group-story-studio">
      <summary>▣ {t.groupStoryCollect}</summary>
      <div className={styles.inner}>
        <p className={styles.disclosure}>
          {isPublic
            ? t.groupStoryPublicRules
            : t.groupStoryPrivateRules}
        </p>
        <form onSubmit={makeEpisode} className={styles.form}>
          <label>
            {t.storyTitle}
            <input aria-label={t.storyTitle} placeholder={t.groupStoryDefault} maxLength={100} required
              value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <fieldset className={styles.choices}>
            <legend>{t.groupStoryChoose} ({chosen.length}/{MAX_PANELS})</legend>
            {messages.length === 0 && <p>{t.groupStoryNoMessages}</p>}
            {messages.filter((m) => !String(m.id).startsWith('temp-')).map((m) => (
              <label key={m.id} className={styles.messageOption}>
                <input type="checkbox" checked={chosen.includes(m.id)} disabled={busy ||
                  (!chosen.includes(m.id) && chosen.length >= MAX_PANELS)}
                  onChange={() => toggle(m.id)}
                  aria-label={`${t.groupStoryInclude}: ${m.original_text.slice(0,45)}`} />
                <span>{m.original_text}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className={styles.primary} disabled={busy ||
            chosen.length===0} data-testid="group-story-create">
            {t.groupStoryCreate} ({chosen.length})
          </button>
        </form>
        <div className={styles.episodeList}>
          <h3>{t.groupStoryEpisodes}</h3>
          <button type="button" disabled={busy} onClick={() => perform(
            () => supabase.rpc('comic_list_group_episodes', {
              p_group_id: groupId, p_limit: 30,
            }).then(({ data, error: loadError }) => {
              if (!loadError) setEpisodes(data || [])
              return { error: loadError }
            }),
            t.storyRefresh
          )}>{t.storyRefresh}</button>
          {episodes.length===0 && <p>{t.groupStoryNone}</p>}
          {episodes.map((e) => (
            <article key={e.episode_id} className={styles.episode} data-testid="group-story-episode">
              <header>
                <span className={styles.tag}>{e.visibility === 'public' ? t.groupStoryPublic : t.groupStoryPrivate}</span>
                <h4>{e.title}</h4>
                <p>{t.storyBy} {e.author_name} · {e.panels.length} {t.storyPanels}</p>
              </header>
              <div className={styles.panels}>
                {e.panels.map((panel, panelIndex) => (
                  <ComicPanel key={panel.id} messageId={panel.id}
                    speaker={panel.speaker} text={panel.text}
                  characterSeed={panel.character?.seed ?? null}
                  supabase={supabase} episodeAsset={panel.illustration?.kind === 'private-comic-art'
                    ? {kind: 'group', episodeId: e.episode_id, panelIndex} : null}
                  styleConfig={panel.style?.primary_style_id === 'classic' ? null : panel.style || null}
                    status="ready" createdAt={panel.created_at} />
                ))}
              </div>
              {isPublic && e.visibility === 'group' &&
                e.author_id === myUserId && e.panels.length > 0 && (
                <button type="button" className={styles.primary}
                  data-testid="group-story-publish"
                  disabled={busy || e.author_id !== myUserId}
                  onClick={() => perform(
                    () => supabase.rpc('comic_publish_group_episode', {
                      p_episode_id: e.episode_id,
                    }),
                    t.groupStoryPublished
                  )}>
                  {t.groupStoryPublish}
                </button>
              )}
            </article>
          ))}
        </div>
        {status && <p role="status" className={styles.status}>{status}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
    </details>
  )
}
