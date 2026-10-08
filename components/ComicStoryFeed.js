import { useCallback, useEffect, useState } from 'react'
import ComicPanel from './ComicPanel'
import styles from '../styles/ComicStoryFeed.module.css'

async function getPublishedStories(supabase) {
  const [direct, group] = await Promise.all([
    supabase.rpc('comic_list_released_episodes', { p_limit: 30 }),
    supabase.rpc('comic_list_public_group_episodes', { p_limit: 30 }),
  ])
  if (direct.error) throw direct.error
  if (group.error) throw group.error
  // Both RPCs return only explicitly published, authorized immutable panel
  // snapshots. Their original private messages and group IDs stay hidden.
  return [...(direct.data || []), ...(group.data || [])]
    .sort((a,b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, 50)
}

export default function ComicStoryFeed({ supabase }) {
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setEpisodes(await getPublishedStories(supabase))
    } catch (loadError) {
      console.error('Unable to load ComicChat stories', loadError)
      setError('Unable to load stories. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    let active = true
    const initialLoad = async () => {
      try {
        const stories = await getPublishedStories(supabase)
        if (active) setEpisodes(stories)
      } catch (loadError) {
        console.error('Unable to load ComicChat stories', loadError)
        if (active) setError('Unable to load stories. Please try again.')
      } finally {
        if (active) setLoading(false)
      }
    }
    initialLoad()
    return () => { active = false }
  }, [supabase])

  return (
    <div className={styles.feed} aria-label="Published comic stories" data-testid="comic-story-feed">
      <header className={styles.heading}>
        <span className={styles.eyebrow}>THE COMICCHAT CHRONICLES</span>
        <h1>Stories from conversations</h1>
        <p>Comics born from real conversations — released with permission.</p>
        <button type="button" className={styles.refresh} onClick={refresh} disabled={loading}>
          Refresh stories
        </button>
      </header>
      {loading && <p role="status">Loading stories…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && episodes.length === 0 && (
        <section className={styles.empty}>
          <span aria-hidden="true">✦</span>
          <h2>The first issue is still being written.</h2>
          <p>Make a comic from your approved private chat or an ordinary public group conversation.</p>
        </section>
      )}
      <div className={styles.stories}>
        {episodes.map((episode) => (
          <article key={episode.episode_id} className={styles.episode} data-testid="comic-story-episode">
            <div className={styles.episodeHeader}>
              <span>COMICCHAT ORIGINAL</span>
              <h2>{episode.title}</h2>
              <p>By {episode.author_name} · {Array.isArray(episode.panels) ? episode.panels.length : 0} panels</p>
            </div>
            <div className={styles.panels}>
              {(Array.isArray(episode.panels) ? episode.panels : []).map((panel) => (
                <ComicPanel key={panel.id} messageId={panel.id}
                  speaker={panel.speaker} text={panel.text}
                  status="ready" createdAt={panel.created_at}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
