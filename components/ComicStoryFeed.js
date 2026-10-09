import { useCallback, useEffect, useRef, useState } from 'react'
import ComicPanel from './ComicPanel'
import useTranslation from '../utils/useTranslation'
import styles from '../styles/ComicStoryFeed.module.css'

async function getPublishedStories(supabase) {
  const results = await Promise.allSettled([
    supabase.rpc('comic_list_released_episodes', { p_limit: 30 }),
    supabase.rpc('comic_list_public_group_episodes', { p_limit: 30 }),
  ])
  const sources = results.map((result, index) => result.status === 'fulfilled' && !result.value.error
    ? (result.value.data || []).map((episode) => ({ ...episode, episode_kind: index ? 'group' : 'direct' }))
    : null)
  if (sources.every((source) => source === null)) throw new Error('stories_unavailable')
  return { partial: sources.some((source) => source === null), episodes: sources.flatMap((source) => source || [])
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at)).slice(0, 50) }
}

export default function ComicStoryFeed({ supabase }) {
  const { t } = useTranslation()
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [partial, setPartial] = useState(false)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const run = ++generation.current
    setLoading(true)
    setError('')
    try {
      const result = await getPublishedStories(supabase)
      if (run !== generation.current) return
      setEpisodes(result.episodes)
      setPartial(result.partial)
    } catch {
      if (run === generation.current) { setEpisodes([]); setError(t.storyFeedError) }
    } finally {
      if (run === generation.current) setLoading(false)
    }
  }, [supabase, t])
  useEffect(() => {
    const initial = setTimeout(refresh, 0)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(onVisible, 30000)
    return () => { generation.current += 1; clearTimeout(initial); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])
  return <div className={styles.feed} aria-label={t.storyFeedLabel} data-testid="comic-story-feed">
    <header className={styles.heading}><span className={styles.eyebrow}>{t.storyChronicles}</span>
      <h1>{t.storyFeedHeading}</h1><p>{t.storyFeedIntro}</p>
      <button type="button" className={styles.refresh} onClick={refresh} disabled={loading}>{t.storyRefresh}</button>
    </header>
    {loading && <p role="status">{t.storyLoading}</p>}
    {error && <p role="alert">{error}</p>}
    {partial && <p role="status">{t.storyPartial}</p>}
    {!loading && !error && episodes.length === 0 && <section className={styles.empty}>
      <span aria-hidden="true">✦</span><h2>{t.storyEmptyHeading}</h2><p>{t.storyEmpty}</p></section>}
    <div className={styles.stories}>{episodes.map((episode) => <article key={`${episode.episode_kind}:${episode.episode_id}`}
      className={styles.episode} data-testid="comic-story-episode">
      <div className={styles.episodeHeader}><span>{t.storyOriginal}</span><h2>{episode.title}</h2>
        <p>{t.storyBy} {episode.author_name} · {episode.panels?.length || 0} {t.storyPanels}</p></div>
      <div className={styles.panels}>{(episode.panels || []).map((panel, panelIndex) => <ComicPanel
        key={panel.id} messageId={panel.id} speaker={panel.speaker} text={panel.text}
        characterSeed={panel.character?.seed ?? null}
        styleConfig={panel.style?.primary_style_id === 'classic' ? null : panel.style || null}
        supabase={supabase} episodeAsset={panel.illustration?.kind === 'private-comic-art'
          ? { kind: episode.episode_kind, episodeId: episode.episode_id, panelIndex } : null}
        status="ready" createdAt={panel.created_at} />)}</div>
    </article>)}</div>
  </div>
}
