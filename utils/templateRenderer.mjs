const SCENES = [
  { key: 'studio', symbol: '✦', label: 'studio scene' },
  { key: 'city', symbol: '▦', label: 'city scene' },
  { key: 'window', symbol: '◫', label: 'window scene' },
  { key: 'night', symbol: '☾', label: 'night scene' },
]

const STATUS = {
  queued: {
    key: 'queued',
    label: 'Queued',
    announcement: 'Comic artwork is queued',
  },
  rendering: {
    key: 'rendering',
    label: 'Rendering',
    announcement: 'Comic artwork is rendering',
  },
  ready: {
    key: 'ready',
    label: 'Ready',
    announcement: 'Comic artwork is ready',
  },
  failed: {
    key: 'failed',
    label: 'Visual failed',
    announcement: 'Comic artwork failed; original message is preserved',
  },
}

export function stableComicSeed(value = '') {
  let hash = 2166136261
  const input = String(value)

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function firstStrongDirection(text) {
  for (const char of String(text)) {
    if (/[֐-ࣿ]/u.test(char)) return 'rtl'
    if (/[A-Za-zÀ-ʯͰ-ԯ]/u.test(char)) return 'ltr'
  }

  return 'auto'
}

function isEmojiCodePoint(codePoint) {
  return (
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x2300 && codePoint <= 0x23ff)
  )
}

function countEmoji(text) {
  let count = 0

  for (const char of String(text)) {
    if (isEmojiCodePoint(char.codePointAt(0))) count += 1
  }

  return count
}

export function getBubbleLayout(text) {
  const exactText = String(text ?? '')
  const characterCount = Array.from(exactText).length
  const lineCount = exactText.split('\n').length
  const emojiCount = countEmoji(exactText)

  let key = 'standard'
  if (characterCount <= 42 && lineCount <= 2) key = 'compact'
  if (characterCount > 180 || lineCount > 5) key = 'expansive'

  const metrics = {
    compact: {
      maxWidth: '30rem',
      minHeight: '5.5rem',
      fontScale: 1.06,
      padding: '0.95rem 1.1rem',
    },
    standard: {
      maxWidth: '34rem',
      minHeight: '7rem',
      fontScale: 1,
      padding: '1rem 1.15rem',
    },
    expansive: {
      maxWidth: '38rem',
      minHeight: '9rem',
      fontScale: 0.94,
      padding: '1.1rem 1.2rem',
    },
  }[key]

  return {
    key,
    characterCount,
    lineCount,
    emojiCount,
    direction: firstStrongDirection(exactText),
    ...metrics,
  }
}

export function getTemplateStatus(status, optimistic = false, preview = false) {
  if (preview) {
    return {
      key: 'draft',
      label: 'Preview',
      announcement: 'Comic message preview',
    }
  }

  if (optimistic) {
    return {
      key: 'sending',
      label: 'Sending',
      announcement: 'Sending comic message',
    }
  }

  const normalized = String(status || 'queued').toLowerCase()
  return STATUS[normalized] || STATUS.queued
}

export function renderTemplate({
  messageId,
  text,
  mine = false,
  status = 'queued',
  optimistic = false,
  preview = false,
}) {
  const exactText = String(text ?? '')
  const seed = stableComicSeed(messageId)
  const scene = SCENES[seed % SCENES.length]

  return {
    renderer: 'TemplateRenderer',
    version: 1,
    messageId: String(messageId),
    text: exactText,
    side: mine ? 'outgoing' : 'incoming',
    scene: {
      ...scene,
      pose: (seed >>> 3) % 3,
      seed,
    },
    character: {
      slot: mine ? 'sender' : 'partner',
      anchor: mine ? 'start' : 'end',
      silhouette: `template-${(seed >>> 5) % 4}`,
    },
    bubble: getBubbleLayout(exactText),
    state: getTemplateStatus(status, optimistic, preview),
  }
}
