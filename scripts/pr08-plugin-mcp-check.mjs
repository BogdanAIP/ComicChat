import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`PR-08 gate: missing ${label}: ${needle}`)
  }
}

const mcp = read('supabase/functions/comicchat-mcp/index.ts')
const consent = read('pages/oauth/consent.js')
const config = read('supabase/config.toml')
const supabaseClient = read('utils/useSupabase.js')
const pkg = JSON.parse(read('package.json'))

for (const tool of [
  'comicchat_profile',
  'list_conversations',
  'get_messages',
  'find_users',
  'open_direct_conversation',
  'send_message',
]) {
  assertIncludes(mcp, `'${tool}'`, `MCP tool ${tool}`)
}

for (const required of [
  'withOAuthProtectedResource',
  "withSupabase({ auth: 'user' })",
  "securitySchemes: oauth",
  "'openai/profile': true",
  "comic_list_direct_conversations",
  "comic_search_users",
  "comic_ensure_direct_conversation",
  "comic_send_message",
  "p_client_nonce: requestId",
]) {
  assertIncludes(mcp, required, 'authenticated MCP boundary')
}

for (const forbidden of [
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
  'OPENAI_API_KEY',
  'localStorage',
  'sessionStorage',
]) {
  if (mcp.includes(forbidden)) {
    throw new Error(`PR-08 gate: MCP server must not contain ${forbidden}`)
  }
}

for (const required of [
  '[auth.oauth_server]',
  'enabled = true',
  'authorization_url_path = "/oauth/consent"',
  'allow_dynamic_registration = true',
  '[functions.comicchat-mcp]',
  'verify_jwt = false',
]) {
  assertIncludes(config, required, 'Supabase OAuth/MCP config')
}

for (const required of [
  'getAuthorizationDetails',
  'approveAuthorization',
  'denyAuthorization',
  '<Auth supabase={supabase} />',
]) {
  assertIncludes(consent, required, 'OAuth consent flow')
}

assertIncludes(
  supabaseClient,
  'export const supabase = createClient(',
  'shared browser Supabase client'
)

const supabaseVersion = pkg.dependencies?.['@supabase/supabase-js']
if (supabaseVersion !== '2.109.0') {
  throw new Error(
    `PR-08 gate: @supabase/supabase-js must stay pinned to OAuth-capable Node-20-compatible 2.109.0, found ${supabaseVersion}`
  )
}

if (pkg.scripts?.['plugin:pr08'] !== 'node scripts/pr08-plugin-mcp-check.mjs') {
  throw new Error('PR-08 gate: plugin:pr08 script missing or changed')
}

console.log('PR-08 plugin/MCP boundaries: PASS')
