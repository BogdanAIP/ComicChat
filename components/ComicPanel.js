import { useEffect, useRef, useState } from 'react'
import { renderTemplate } from '../utils/templateRenderer.mjs'
import { styleVisualTokens } from '../utils/comicStyleSkills.mjs'
import useTranslation from '../utils/useTranslation'
import panelStyles from '../styles/ComicPanel.module.css'
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
  mediaAssetId = null,
  episodeAsset = null,
  characterSeed = null,
}) {
  const { t } = useTranslation()
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
    characterSeed,
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

  const episodeArtKey = !preview && supabase && episodeAsset
    ? `${episodeAsset.kind}:${episodeAsset.episodeId}:${episodeAsset.panelIndex}` : null
  const privateArtKey =
    !preview &&
    status === 'ready' &&
    mediaStorageEnabled &&
    supabase &&
    conversationId &&
    messageId &&
    !String(messageId).startsWith('temp-')
      ? mediaAssetId && mediaAssetId !== messageId
        ? `${conversationId}/${messageId}/${mediaAssetId}.webp`
        : `${conversationId}/${messageId}.webp`
      : null
  const artKey = episodeArtKey || privateArtKey
  const artUrl =
    artKey && privateArt?.key === artKey ? privateArt.url : null

  useEffect(() => {
    if (!artKey || !supabase) return undefined

    let cancelled = false
    let objectUrl = null

    const loadPrivateArt = async () => {
      setPrivateArt({ key: artKey, loading: true })
      const { data, error } = episodeArtKey
        ? await supabase.functions.invoke('comicchat-story-art', { body: {
            episodeKind: episodeAsset.kind, episodeId: episodeAsset.episodeId,
            panelIndex: episodeAsset.panelIndex,
          } })
        : await supabase.storage.from('comicchat-art').download(privateArtKey)

      if (cancelled) return
      if (error || !(data instanceof Blob)) {
        setPrivateArt({ key: artKey, error: true })
        return
      }

      objectUrl = URL.createObjectURL(data)
      if (cancelled) {
        URL.revokeObjectURL(objectUrl)
        objectUrl = null
        return
      }

      setPrivateArt({ key: artKey, url: objectUrl })
    }

    loadPrivateArt()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  // The frozen asset key identifies the request; object identity from the
  // parent render must not repeatedly download the same artwork.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artKey, supabase])

  const exactText = renderModel.text
  const accessibleId = `comic-${String(messageId).replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const stateLabels = { queued: t.panelQueued, rendering: t.panelRendering,
    ready: t.panelReady, failed: t.panelFailed, sending: t.panelSending,
    draft: t.panelDraft, 'retry-preview': t.panelRetry }
  const stateLabel = status === 'ready' && !preview
    ? artUrl ? t.panelReady
      : privateArt?.key === artKey && privateArt?.error ? t.panelArtUnavailable
        : artKey ? t.panelArtLoading : t.panelTemplate
    : stateLabels[state.key] || state.label

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
                ? `${t.panelArtLabel}: ${speaker}`
                : `${t.panelPlaceholder}: ${speaker}`
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
                  className={`${styles.characterSilhouette} ${styles[`pose_${scene.pose}`]} ${panelStyles.character}`}
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
            <p>{exactText || t.panelEmptyDraft}</p>
          </div>

          <div className={styles.visualState} aria-hidden="true">
            <span className={styles.visualStateDot} />
            <span>{stateLabel}</span>
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
                aria-label={`${t.panelCopy}: ${speaker}`}
              >
                {t.panelCopy}
              </button>
            )}

            {!preview && !mine && onReport && (
              <button
                type="button"
                className={styles.comicAction}
                onClick={() => onReport(messageId)}
                disabled={reporting}
                aria-label={`${t.panelReport}: ${speaker}`}
              >
                {reporting ? t.panelReporting : t.panelReport}
              </button>
            )}

            {!preview && state.key === 'failed' && (
              <button
                type="button"
                className={styles.comicAction}
                onClick={retryPreview}
                aria-label={t.panelRetryLabel}
              >
                {t.panelRetry}
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
        {stateLabel}
      </span>

      {!preview && copyState === 'copied' && (
        <span className={styles.srOnly} role="status" aria-live="polite">
          {t.panelCopied}
        </span>
      )}
      {!preview && copyState === 'failed' && (
        <span className={styles.srOnly} role="alert">
          {t.panelCopyFailed}
        </span>
      )}
    </article>
  )
}
