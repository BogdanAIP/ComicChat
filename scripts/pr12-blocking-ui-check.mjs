import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function expect(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`PR-12 invariant missing: ${label}`)
  }
}

function expectOneOf(source, needles, label) {
  if (!needles.some((needle) => source.includes(needle))) {
    throw new Error(`PR-12 invariant missing: ${label}`)
  }
}

const component = read('components/ComicDirectMessages.js')
const styles = read('styles/ComicDirectMessages.module.css')
const roadmap = read('ROADMAP.md')
const docs = read('docs/PR12_WEB_BLOCKING_CONTROLS.md')
const ci = read('.github/workflows/ci.yml')

expect(component, "supabase.rpc('comic_list_blocked_users')", 'web lists blocks through RPC')
expect(component, "'comic_unblock_user' : 'comic_block_user'", 'web mutations choose RPC only')
expect(component, 'p_user_id: selectedPartnerId', 'exact selected partner identity')
expect(component, 'selectedBlockedByMe', 'selected block state')
expect(component, "window.confirm(", 'explicit block confirmation')
expect(component, 'Existing history stays visible', 'non-destructive block copy')
expectOneOf(
  component,
  ['disabled={selectedBlockedByMe}', 'disabled={deletionPending || selectedBlockedByMe}'],
  'blocked composer disabled'
)
expectOneOf(
  component,
  [
    'busy || selectedBlockedByMe || !draft.trim()',
    'busy || deletionPending || selectedBlockedByMe || !draft.trim()',
  ],
  'blocked send button disabled'
)
expect(component, "includes('interaction_blocked')", 'server-side opposite block surfaced')
expect(component, 'setDraft(originalText)', 'failed send restores draft')
expect(component, 'messages.map((message)', 'history rendering preserved')
expect(styles, '.safetyButton', 'block control styling')
expect(styles, '.safetyButton:focus-visible', 'keyboard focus styling')
expect(styles, '.safetyNotice', 'blocking status styling')
expect(docs, 'database remains authoritative', 'documented server authority')
expect(roadmap, '| PR-12 |', 'roadmap PR-12 row')
expect(ci, 'npm run ux:pr12', 'CI PR-12 gate')

console.log('PR-12 web blocking UX boundaries passed.')
