import { useEffect, useState } from 'react'
import { renderTemplate } from '../utils/templateRenderer.mjs'
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
  speaker,
  text,
  status = 'queued',
  mine = false,
  optimistic = false,
  createdAt = null,
  preview = false,
  onReport = null,
  reporting = false,
  onRetryGeneration = null,
  retrying = false,
  supabase = null,
  mediaStorageEnabled = false,
}) {
  const [copyState, setCopyState] = useState('idle')
  const [privateArt, setPrivateArt] = useState(null)
  const renderModel = renderTemplate({
    messageId,
    text,
    mine,
    status,
    optimistic,
    preview,
  })
  const scene = renderModel.scene
  const persistedState = renderModel.state
  const state = persistedState

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
      aria-labelledby={`${accessibleId}-speaker`}
      aria-describedby={`${accessibleId}-status`}
    >
      <figure className={styles.comicFigure}>
        <div className={`${styles.comicScene} ${styles[`scene_${scene.key}`]}`}>
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

            {!preview && mine && state.key === 'failed' && onRetryGeneration && (
              <button
                type="button"
                className={styles.comicAction}
                onClick={() => onRetryGeneration(messageId)}
                disabled={retrying}
                aria-label="Retry rendering this same ComicChat message"
              >
                {retrying ? 'Retrying…' : 'Retry render'}
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
