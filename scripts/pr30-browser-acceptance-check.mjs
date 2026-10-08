import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) {
    throw new Error(`PR-30 acceptance gate missing: ${label}: ${needle}`)
  }
}
const forbid = (source, needle, label) => {
  if (source.includes(needle)) {
    throw new Error(`PR-30 acceptance gate forbidden: ${label}: ${needle}`)
  }
}

const auth = read('components/Auth.js')
const profile = read('components/Profile.js')
const home = read('pages/index.js')
const comic = read('components/ComicDirectMessages.js')
const testFile = read('browser-tests/pr30-two-account.spec.mjs')
const config = read('playwright.config.mjs')
const workflow = read('.github/workflows/browser-acceptance.yml')
const docs = read('docs/PR30_BROWSER_ACCEPTANCE.md')
const roadmap = read('ROADMAP.md')
const pkg = JSON.parse(read('package.json'))

for (const [source, needle, label] of [
  [auth, 'data-testid="auth-email"', 'auth email selector'],
  [auth, 'data-testid="auth-password"', 'auth password selector'],
  [auth, 'data-testid="auth-submit"', 'auth submit selector'],
  [profile, 'data-testid="profile-page"', 'profile root selector'],
  [profile, 'data-current-user-ready=', 'profile readiness selector'],
  [profile, 'data-testid="profile-edit-username"', 'profile edit selector'],
  [profile, 'data-testid="profile-username-input"', 'profile username selector'],
  [profile, 'data-testid="profile-save"', 'profile save selector'],
  [home, 'data-testid="comicchat-nav"', 'ComicChat navigation selector'],
  [home, 'data-testid="profile-nav"', 'Profile navigation selector'],
  [comic, 'data-testid="comic-private-shell"', 'private shell selector'],
  [comic, 'data-testid="comic-user-search"', 'user search selector'],
  [comic, 'data-testid="comic-search-result"', 'search result selector'],
  [comic, 'data-testid="comic-chat-title"', 'conversation title selector'],
  [comic, 'data-testid="comic-connection"', 'Realtime state selector'],
  [comic, 'data-testid="comic-composer"', 'composer selector'],
  [comic, 'data-testid="comic-send"', 'send selector'],
]) {
  expect(source, needle, label)
}

for (const required of [
  "browser.newContext()",
  "await openConversation(pageA, usernameB)",
  "await openConversation(pageB, usernameA)",
  "PR30 exact A-to-B",
  "PR30 exact B-to-A",
  "toHaveText('Live')",
  "getByText(aToB, { exact: true })",
  "getByText(bToA, { exact: true })",
]) {
  expect(testFile, required, 'two-account browser scenario')
}

forbid(testFile, 'page.reload(', 'Realtime acceptance must not manually reload pages')

for (const required of [
  "workers: 1",
  "retries: 0",
  "trace: 'retain-on-failure'",
  "name: 'chromium'",
]) {
  expect(config, required, 'deterministic Playwright configuration')
}

for (const required of [
  'npm install --no-save --package-lock=false @playwright/test@1.64.0',
  'npx playwright install --with-deps chromium',
  'Start isolated local Supabase',
  'Run two-account browser acceptance',
  'environment: comicchat-staging',
  'STAGING_E2E_USER_A_EMAIL',
  'STAGING_E2E_USER_A_PASSWORD',
  'STAGING_E2E_USER_B_EMAIL',
  'STAGING_E2E_USER_B_PASSWORD',
  'site_url must be HTTPS',
]) {
  expect(workflow, required, 'browser acceptance workflow')
}

const staging = workflow.split('  staging:')[1] || ''
forbid(staging, 'SERVICE_ROLE', 'staging browser job must not receive service role')
forbid(staging, 'OPENAI_API_KEY', 'staging browser job must not receive provider key')
forbid(staging, 'SUPABASE_DB_PASSWORD', 'staging browser job must not receive database password')

for (const required of [
  'Playwright',
  'two independent browser sessions',
  'does not receive a Supabase service-role key',
  'Vercel ChatGPT connector is available but was not installed',
]) {
  expect(docs, required, 'browser acceptance documentation')
}

expect(roadmap, '| PR-30 |', 'roadmap PR-30 milestone')

if (pkg.scripts?.['acceptance:pr30'] !== 'node scripts/pr30-browser-acceptance-check.mjs') {
  throw new Error('PR-30 acceptance:pr30 script missing from package.json')
}

console.log('PR-30 two-account browser acceptance boundaries passed.')
