import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) {
    throw new Error(`PR-29 shell gate missing: ${label}: ${needle}`)
  }
}
const forbid = (source, needle, label) => {
  if (source.includes(needle)) {
    throw new Error(`PR-29 shell gate forbidden: ${label}: ${needle}`)
  }
}

const home = read('pages/index.js')
const docs = read('docs/PR29_COMICCHAT_FIRST_SHELL.md')
const roadmap = read('ROADMAP.md')
const pkg = JSON.parse(read('package.json'))

expect(home, "useState('private')", 'ComicChat default tab')
expect(home, "import ComicDirectMessages from '../components/ComicDirectMessages'", 'protected ComicChat component reuse')
expect(home, '<title>ComicChat</title>', 'ComicChat page title')
expect(home, 'Private comic-first conversations where each message becomes a visual panel.', 'ComicChat page description')
expect(home, '>ComicChat</div>', 'ComicChat navigation entry')
expect(home, "onBack={() => setTab('private')}", 'Profile returns to ComicChat')

for (const forbidden of [
  "import Chat from '../components/Chat'",
  "setTab('public')",
  "tab === 'public'",
  '{t.publicChat}',
]) {
  forbid(home, forbidden, 'legacy public chat removed from beta homepage')
}

for (const required of [
  'reuse the already-tested ComicChat component',
  'does not build another UI shell',
  'no custom `vercel.json`',
  'legacy public-room',
]) {
  expect(docs, required, 'reuse-first shell documentation')
}

expect(roadmap, '| PR-29 |', 'roadmap PR-29 milestone')

if (pkg.scripts?.['beta:pr29'] !== 'node scripts/pr29-comicchat-first-shell-check.mjs') {
  throw new Error('PR-29 beta:pr29 script missing from package.json')
}

console.log('PR-29 ComicChat-first shell boundaries passed.')
