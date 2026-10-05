import fs from 'node:fs'

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const chat = read('components/ComicDirectMessages.js')
const panel = read('components/ComicPanel.js')
const presentation = read('utils/templateRenderer.mjs')
const css = read('styles/ComicDirectMessages.module.css')

const failures = []

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`missing: ${label}`)
}

const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`forbidden: ${label}`)
}

requireText(
  chat,
  "import ComicPanel from './ComicPanel'",
  'private chat imports reusable ComicPanel'
)

const panelUsages = (chat.match(/<ComicPanel/g) || []).length
if (panelUsages < 2) {
  failures.push(
    `expected ComicPanel in both history and composer preview; found ${panelUsages}`
  )
}

requireText(
  chat,
  'messageId={message.id}',
  'persisted and optimistic history cards use the message id'
)
requireText(
  chat,
  'messageId={`draft:${selectedConversationId}`}',
  'composer has a deterministic preview card'
)
requireText(
  chat,
  'text={draft}',
  'composer preview renders the exact draft'
)
requireText(
  chat,
  'const tempId = `temp-${clientNonce}`',
  'optimistic visual card keeps client nonce identity'
)
requireText(
  chat,
  'message.client_nonce === nextMessage.client_nonce',
  'persisted row replaces optimistic card by client nonce'
)

forbidText(chat, 'styles.message}', 'legacy text message bubble rendering')
forbidText(chat, '<p>{message.original_text}</p>', 'plain text-only history row')

requireText(panel, '<figure', 'semantic comic figure')
requireText(panel, '<figcaption', 'semantic comic caption')
requireText(panel, 'role="img"', 'decorative scene has image semantics')
requireText(panel, 'aria-labelledby=', 'comic card has accessible speaker label')
requireText(panel, 'aria-describedby=', 'comic card exposes status description')
requireText(panel, 'role="status"', 'visual state is announced')
requireText(panel, 'Copy original text', 'copy-original action')
requireText(
  panel,
  'navigator.clipboard.writeText(exactText)',
  'copy action uses exact unmodified source text'
)
requireText(panel, 'Retry preview', 'failed card has same-slot retry preview affordance')
requireText(
  panel,
  'data-message-id={messageId}',
  'retry/visual state stays attached to the same message id'
)
forbidText(panel, '.rpc(', 'presentation component must not mutate server state')
forbidText(panel, 'writeText(exactText.trim', 'copy must not trim original text')
forbidText(panel, 'writeText(exactText.slice', 'copy must not truncate original text')

for (const status of ['queued', 'rendering', 'ready', 'failed']) {
  requireText(presentation, `${status}: {`, `presentation state ${status}`)
}

requireText(css, 'white-space: pre-wrap', 'long text preserves line breaks')
requireText(css, 'overflow-wrap: anywhere', 'long text remains readable')
requireText(css, ':focus-visible', 'keyboard focus is visible')
requireText(css, '@media (prefers-reduced-motion: reduce)', 'reduced-motion support')
requireText(css, '.srOnly', 'screen-reader-only status utility')
requireText(css, '.comicCardPreview', 'composer visual preview styling')

if (failures.length) {
  console.error('PR-03 comic-first UX boundary check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('PR-03 comic-first UX boundary check passed.')
