import { useEffect, useRef, useState } from 'react'
import { renderTemplate } from '../utils/templateRenderer.mjs'
import { styleVisualTokens } from '../utils/comicStyleSkills.mjs'
import styles from '../styles/ComicDirectMessages.module.css'

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function ComicPanel({
  messageId,
  conversationId,
  senderId = null,
  styleConfig = null,
  speaker,
  text,
  status = 'queued',
  mine = false,
  optimistic = false,
  createdAt = null,
  preview = false,
  onReport = null,
  reporting = false,
  supabase = null,
  mediaStorageEnabled = false,
}) {
  const [copyState, setCopyState] = useState('idle')
  const [retryPreviewing, setRetryPreviewing] = useState(false)
  const [privateArt, setPrivateArt] = useState(null)
  const retryTimerRef = useRef(null)
  const renderModel = renderTemplate({
    messageId,
    text,
    mine,
    status,
    optimistic,
    preview,
    senderId,
    styleConfig,
  })
  const scene = renderModel.scene
  const visualTokens = renderModel.style ? styleVisualTokens(renderModel.style) : undefined
  const persistedState = renderModel.state
  const state = retryPreviewing
    ? {
        key: 'retry-preview',
        label: 'Retry preview',
        announcement: 'Demo visual retry is previewing on the same message',
      }
    : persistedState

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  const privateArtKey =
    !preview &&
    status === 'ready' &&
    mediaStorageEnabled &&
    supabase &&
    conversationId &&
    messageId &&
    !String(messageId).startsWith('temp-')
      ? `${conversationId}/${messageId}.webp`
      : null
  const artUrl =
    privateArtKey && privateArt?.key === privateArtKey ? privateArt.url : null

  useEffect(() => {
    if (!privateArtKey || !supabase) return undefined

    let cancelled = false
    let objectUrl = null

    const loadPrivateArt = async () => {
      const { data, error } = await supabase.storage
        .from('comicchat-art')
        .download(privateArtKey)

      if (cancelled || error || !data) return

      objectUrl = URL.createObjectURL(data)
      if (cancelled) {
        URL.revokeObjectURL(objectUrl)
        objectUrl = null
        return
      }

      setPrivateArt({ key: privateArtKey, url: objectUrl })
    }

    loadPrivateArt()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [privateArtKey, supabase])

  const exactText = renderModel.text
  const accessibleId = `comic-${String(messageId).replace(/[^a-zA-Z0-9_-]/g, '-')}`

  const retryPreview = () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    setRetryPreviewing(true)
    retryTimerRef.current = setTimeout(() => {
      setRetryPreviewing(false)
      retryTimerRef.current = null
    }, 1200)
  }

  const copyOriginal = async () => {
    try {
      await navigator.clipboard.writeText(exactText)
      setCopyState('copied')
    } catch (error) {
      console.error('Unable to copy original ComicChat text', error)
      setCopyState('failed')
    }
  }

  return (
    <article
      className={`${styles.comicCard} ${mine ? styles.comicCardMine : styles.comicCardIncoming} ${preview ? styles.comicCardPreview : ''}`}
      data-message-id={messageId}
      data-message-status={preview ? 'draft' : persistedState.key}
      data-visual-state={state.key}
      data-renderer={renderModel.renderer}
      data-renderer-version={renderModel.version}
      data-style-primary={renderModel.style?.primary_style_id || 'classic'}
      data-style-secondary={renderModel.style?.secondary_style_id || ''}
      aria-labelledby={`${accessibleId}-speaker`}
      aria-describedby={`${accessibleId}-status`}
    >
      <figure className={styles.comicFigure}>
        <div className={`${styles.comicScene} ${styles[`scene_${scene.key}`]}`}
          data-comic-style={renderModel.style?.primary_style_id || undefined}
          style={visualTokens}>
          <div
            className={styles.sceneArtwork}
            role="img"
            aria-label={
              artUrl
                ? `Private generated comic artwork for ${speaker}`
                : `Decorative ${scene.label} placeholder for ${speaker}`
            }
          >
            {artUrl ? (
              <img
                className={styles.generatedArtwork}
                src={artUrl}
                alt=""
                aria-hidden="true"
              />
            ) : (
              <>
                <div className={styles.sceneTexture} aria-hidden="true" />
                <div
                  className={`${styles.characterSilhouette} ${styles[`pose_${scene.pose}`]}`}
                  data-character-template={renderModel.character.silhouette}
                  aria-hidden="true"
                >
                  <span className={styles.characterHead} />
                  <span className={styles.characterBody} />
                </div>
                <span className={styles.sceneSymbol} aria-hidden="true">
                  {scene.symbol}
                </span>
              </>
            )}
          </div>

          <div
            className={styles.speechBubble}
            data-bubble-layout={renderModel.bubble.key}
            dir={renderModel.bubble.direction}
            style={{
              maxWidth: renderModel.bubble.maxWidth,
              minHeight: renderModel.bubble.minHeight,
              padding: renderModel.bubble.padding,
              fontSize: `${renderModel.bubble.fontScale}rem`,
            }}
          >
            <p>{exactText || 'Your message will appear here exactly as typed.'}</p>
          </div>

          <div className={styles.visualState} aria-hidden="true">
            <span className={styles.visualStateDot} />
            <span>{state.label}</span>
          </div>
        </div>

        <figcaption className={styles.comicCaption}>
          <div className={styles.comicIdentity}>
            <span id={`${accessibleId}-speaker`} className={styles.comicSpeaker}>
              {speaker}
            </span>
            {!preview && createdAt && (
              <time dateTime={createdAt}>{formatTime(createdAt)}</time>
            )}
          </div>

          <div className={styles.comicActions}>
            {!preview && (
              <button
                type="button"
                className={styles.comicAction}
                onClick={copyOriginal}
                aria-label={`Copy original text from ${speaker}`}
              >
                Copy original text
              </button>
            )}

            {!preview && !mine && onReport && (
              <button
                type="button"
                className={styles.comicAction}
                onClick={() => onReport(messageId)}
                disabled={reporting}
                aria-label={`Report message from ${speaker}`}
              >
                {reporting ? 'Reporting…' : 'Report'}
              </button>
            )}

            {!preview && state.key === 'failed' && (
              <button
                type="button"
                className={styles.comicAction}
                onClick={retryPreview}
                aria-label="Preview a visual retry on this same message without changing server state"
              >
                Retry preview
              </button>
            )}
          </div>
        </figcaption>
      </figure>

      <span
        id={`${accessibleId}-status`}
        className={styles.srOnly}
        role="status"
        aria-live="polite"
      >
        {state.announcement}
      </span>

      {!preview && copyState === 'copied' && (
        <span className={styles.srOnly} role="status" aria-live="polite">
          Original text copied exactly.
        </span>
      )}
      {!preview && copyState === 'failed' && (
        <span className={styles.srOnly} role="alert">
          Could not copy original text.
        </span>
      )}
    </article>
  )
}
