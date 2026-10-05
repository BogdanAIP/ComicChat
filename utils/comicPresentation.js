const SCENES = [
  { key: 'studio', symbol: '✦', label: 'studio scene' },
  { key: 'city', symbol: '▦', label: 'city scene' },
  { key: 'window', symbol: '◫', label: 'window scene' },
  { key: 'night', symbol: '☾', label: 'night scene' },
]

export function stableComicSeed(value = '') {
  let hash = 2166136261
  const input = String(value)

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

export function getComicScene(messageId, mine = false) {
  const seed = stableComicSeed(messageId)
  const scene = SCENES[seed % SCENES.length]

  return {
    ...scene,
    pose: (seed >>> 3) % 3,
    side: mine ? 'outgoing' : 'incoming',
  }
}

export function getComicStatus(status, optimistic = false) {
  if (optimistic) {
    return {
      key: 'sending',
      label: 'Sending',
      announcement: 'Sending comic message',
    }
  }

  const normalized = String(status || 'queued').toLowerCase()

  if (normalized === 'rendering') {
    return {
      key: 'rendering',
      label: 'Rendering',
      announcement: 'Comic artwork is rendering',
    }
  }

  if (normalized === 'ready') {
    return {
      key: 'ready',
      label: 'Ready',
      announcement: 'Comic artwork is ready',
    }
  }

  if (normalized === 'failed') {
    return {
      key: 'failed',
      label: 'Visual failed',
      announcement: 'Comic artwork failed; original message is preserved',
    }
  }

  return {
    key: 'queued',
    label: 'Queued',
    announcement: 'Comic artwork is queued',
  }
}

export function getComicAriaLabel({ speaker, text, status, optimistic = false }) {
  const state = getComicStatus(status, optimistic)
  const exactText = String(text ?? '')
  return `${speaker}. ${state.announcement}. Message: ${exactText}`
}
