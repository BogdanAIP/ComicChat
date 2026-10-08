import { useCallback, useEffect, useState } from 'react'
import ComicPanel from './ComicPanel'
import styles from '../styles/ComicStoryFeed.module.css'

export default function ComicStoryFeed({ supabase }) {
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: loadError } = await supabase.rpc(
        'comic_list_released_episodes',
        { p_limit: 30 }
      )
      if (loadError) throw loadError
      setEpisodes(data || [])
    } catch (loadError) {
      console.error('Unable to load ComicChat stories', loadError)
      setError('Unable to load stories. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    let active = true
    const loadInitially = async () => {
      const { data, error: initialError } = await supabase.rpc(
        'comic_list_released_episodes',
        { p_limit: 30 }
      )
      if (!active) return
      if (initialError) {
        console.error('Unable to load ComicChat stories', initialError)
        setError('Unable to load stories. Please try again.')
      } else {
        setEpisodes(data || [])
      }
      setLoading(false)
    }
    loadInitially()
    return () => { active = false }
  }, [supabase])

  return (
    <div className={styles.feed} aria-label="Published comic stories" data-testid="comic-story-feed">
      <header className={styles.heading}>
        <span className={styles.eyebrow}>THE COMICCHAT CHRONICLES</span>
        <h1>Stories from conversations</h1>
        <p>These comics started as real chats and were published with permission.</p>
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
          <p>Start a private chat, request one permission, then publish your first comic.</p>
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
                <ComicPanel
                  key={panel.id}
                  messageId={panel.id}
                  speaker={panel.speaker}
                  text={panel.text}
                  status="ready"
                  createdAt={panel.created_at}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
