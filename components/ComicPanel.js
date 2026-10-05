import { useState } from 'react'
import {
  getComicAriaLabel,
  getComicScene,
  getComicStatus,
} from '../utils/comicPresentation'
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
  speaker,
  text,
  status = 'queued',
  mine = false,
  optimistic = false,
  createdAt = null,
  preview = false,
  onRetryPreview = null,
}) {
  const [copyState, setCopyState] = useState('idle')
  const scene = getComicScene(messageId, mine)
  const state = preview
    ? {
        key: 'draft',
        label: 'Preview',
        announcement: 'Comic message preview',
      }
    : getComicStatus(status, optimistic)

  const exactText = String(text ?? '')
  const ariaLabel = preview
    ? `${speaker}. Comic message preview. Message: ${exactText}`
    : getComicAriaLabel({
        speaker,
        text: exactText,
        status,
        optimistic,
      })

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
      data-message-status={state.key}
      aria-label={ariaLabel}
    >
      <figure className={styles.comicFigure}>
        <div
          className={`${styles.comicScene} ${styles[`scene_${scene.key}`]}`}
          role="img"
          aria-label={`Decorative ${scene.label} placeholder for ${speaker}`}
        >
          <div className={styles.sceneTexture} aria-hidden="true" />
          <div
            className={`${styles.characterSilhouette} ${styles[`pose_${scene.pose}`]}`}
            aria-hidden="true"
          >
            <span className={styles.characterHead} />
            <span className={styles.characterBody} />
          </div>
          <span className={styles.sceneSymbol} aria-hidden="true">
            {scene.symbol}
          </span>

          <div className={styles.speechBubble}>
            <p>{exactText || 'Your message will appear here exactly as typed.'}</p>
          </div>

          <div className={styles.visualState} aria-hidden="true">
            <span className={styles.visualStateDot} />
            <span>{state.label}</span>
          </div>
        </div>

        <figcaption className={styles.comicCaption}>
          <div className={styles.comicIdentity}>
            <span className={styles.comicSpeaker}>{speaker}</span>
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

            {!preview && state.key === 'failed' && (
              <button
                type="button"
                className={styles.comicAction}
                onClick={() => onRetryPreview?.(messageId)}
                aria-label="Retry visual preview for this same message"
              >
                Retry preview
              </button>
            )}
          </div>
        </figcaption>
      </figure>

      <span className={styles.srOnly} role="status" aria-live="polite">
        {preview ? state.announcement : getComicStatus(status, optimistic).announcement}
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
