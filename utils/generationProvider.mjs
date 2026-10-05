import { renderTemplate } from './templateRenderer.mjs'

function stableHash(value) {
  let hash = 2166136261

  for (const character of String(value)) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619) >>> 0
  }

  return hash >>> 0
}

export class TemplateRendererProvider {
  constructor() {
    this.name = 'template'
    this.billingSource = 'template'
  }

  async generate({
    messageId,
    text,
    mine = false,
    status = 'ready',
  }) {
    return {
      provider: this.name,
      billingSource: this.billingSource,
      billableUnits: 0,
      costMicrounits: 0,
      renderModel: renderTemplate({
        messageId,
        text,
        mine,
        status,
      }),
    }
  }
}

export class MockProvider {
  constructor() {
    this.name = 'mock'
    this.billingSource = 'mock'
  }

  async generate({
    messageId,
    sceneKey = 'studio',
    characterToken = 'template-0',
  }) {
    if (!messageId) throw new Error('messageId is required')

    const seed = stableHash(messageId)

    return {
      provider: this.name,
      billingSource: this.billingSource,
      billableUnits: 0,
      costMicrounits: 0,
      illustration: {
        kind: 'mock-comic-art',
        version: 1,
        seed,
        sceneKey: String(sceneKey),
        characterToken: String(characterToken),
        containsText: false,
      },
    }
  }
}

export function createGenerationProvider(name) {
  const normalized = String(name || '').toLowerCase()

  if (normalized === 'template') return new TemplateRendererProvider()
  if (normalized === 'mock') return new MockProvider()

  if (normalized === 'official-image') {
    throw new Error(
      'OfficialImageAPIProvider is not enabled in PR-05; provider and billing approval are a separate gate'
    )
  }

  throw new Error('Unknown ComicChat generation provider: ' + normalized)
}
