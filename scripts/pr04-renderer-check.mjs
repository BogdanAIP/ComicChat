import fs from 'node:fs'

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const panel = read('components/ComicPanel.js')
const renderer = read('utils/templateRenderer.mjs')
const css = read('styles/ComicDirectMessages.module.css')
const golden = JSON.parse(
  read('tests/golden/pr04-template-renderer.json')
)

const failures = []

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`missing: ${label}`)
}

const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`forbidden: ${label}`)
}

requireText(
  panel,
  "import { renderTemplate } from '../utils/templateRenderer.mjs'",
  'ComicPanel consumes TemplateRenderer'
)
requireText(panel, 'const renderModel = renderTemplate({', 'render model construction')
requireText(panel, 'data-renderer={renderModel.renderer}', 'renderer identity on card')
requireText(panel, 'data-bubble-layout={renderModel.bubble.key}', 'bubble layout identity')
requireText(panel, 'dir={renderModel.bubble.direction}', 'bubble text direction')
requireText(panel, 'data-character-template={renderModel.character.silhouette}', 'character template token')
requireText(panel, 'maxWidth: renderModel.bubble.maxWidth', 'renderer max width metric')
requireText(panel, 'minHeight: renderModel.bubble.minHeight', 'renderer min height metric')
requireText(panel, 'padding: renderModel.bubble.padding', 'renderer padding metric')
requireText(panel, 'fontSize: `${renderModel.bubble.fontScale}rem`', 'renderer font metric')

forbidText(panel, 'getComicScene', 'legacy ad-hoc scene helper')
forbidText(panel, 'getComicStatus', 'legacy ad-hoc status helper')

requireText(renderer, "renderer: 'TemplateRenderer'", 'TemplateRenderer descriptor')
requireText(renderer, 'version: 1', 'renderer descriptor version')
requireText(renderer, "const exactText = String(text ?? '')", 'exact text preservation')
requireText(renderer, 'getBubbleLayout(exactText)', 'bubble layout derivation')
requireText(renderer, 'firstStrongDirection(exactText)', 'text direction derivation')
requireText(renderer, 'stableComicSeed(messageId)', 'stable message seed')

for (const forbidden of [
  'fetch(',
  '.rpc(',
  'supabase',
  'navigator',
  'window.',
  'Date.now(',
  'Math.random(',
]) {
  forbidText(renderer, forbidden, `renderer side effect/randomness: ${forbidden}`)
}

forbidText(renderer, 'exactText.trim(', 'renderer must not trim source text')
forbidText(renderer, 'exactText.slice(', 'renderer must not truncate source text')

for (const key of ['compact', 'standard', 'expansive']) {
  requireText(renderer, `${key}: {`, `bubble layout ${key}`)
}

for (const state of ['queued', 'rendering', 'ready', 'failed']) {
  requireText(renderer, `${state}: {`, `renderer status ${state}`)
}

if (golden.renderer !== 'TemplateRenderer' || golden.version !== 1) {
  failures.push('golden fixture renderer/version mismatch')
}

for (const requiredCase of [
  'short-outgoing-ready',
  'multiline-incoming-rendering',
  'emoji-incoming-queued',
  'rtl-incoming-failed',
  'long-outgoing-ready',
]) {
  if (!golden.cases.some((entry) => entry.name === requiredCase)) {
    failures.push(`missing golden fixture: ${requiredCase}`)
  }
}

requireText(css, 'unicode-bidi: plaintext', 'mixed-direction text isolation')
requireText(css, 'text-align: start', 'logical bubble alignment')
requireText(css, 'font-size: inherit', 'renderer-controlled bubble font size')

if (failures.length) {
  console.error('PR-04 TemplateRenderer boundary check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('PR-04 TemplateRenderer boundary check passed.')
