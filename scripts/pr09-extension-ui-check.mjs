import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`PR-09 gate: missing ${label}: ${needle}`)
  }
}

const mcp = read('supabase/functions/comicchat-mcp/index.ts')
const ui = read('supabase/functions/comicchat-mcp/ui.ts')
const pkg = JSON.parse(read('package.json'))

for (const required of [
  "'open_comicchat_app'",
  "'ui://comicchat/app-v1.html'",
  "server.registerResource(",
  "mimeType: 'text/html;profile=mcp-app'",
  "ui: { resourceUri: COMICCHAT_APP_URI }",
  "entrypoints: [{ type: 'global' }, { type: 'thread' }]",
  "availableDisplayModes: ['inline', 'fullscreen']",
  "securitySchemes: oauth",
]) {
  assertIncludes(mcp, required, 'Plugin Extension resource/tool contract')
}

for (const required of [
  "rpcRequest('ui/initialize'",
  "rpcNotify('ui/notifications/initialized'",
  "rpcRequest('tools/call'",
  "'ui/notifications/tool-result'",
  "callTool('get_messages'",
  "callTool('send_message'",
  "callTool('list_conversations'",
  'crypto.randomUUID()',
  'pendingRequestId',
]) {
  assertIncludes(ui, required, 'MCP Apps bridge')
}

for (const forbidden of [
  'NEXT_PUBLIC_SUPABASE',
  'SUPABASE_SERVICE_ROLE_KEY',
  'Authorization:',
  'localStorage',
  'sessionStorage',
  'document.cookie',
  'OPENAI_API_KEY',
]) {
  if (ui.includes(forbidden)) {
    throw new Error(`PR-09 gate: UI must not contain direct credential/storage path: ${forbidden}`)
  }
}

if (pkg.scripts?.['extension:pr09'] !== 'node scripts/pr09-extension-ui-check.mjs') {
  throw new Error('PR-09 gate: extension:pr09 script missing or changed')
}

console.log('PR-09 Plugin Extension UI boundaries: PASS')
