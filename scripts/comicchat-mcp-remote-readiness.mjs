// Read-only remote readiness probe for an authenticated ComicChat MCP plugin.
// Does NOT create users, register OAuth clients, write to Supabase or use secrets.
const endpoint = process.env.COMICCHAT_MCP_URL ||
  'https://qbqfxuijnispicvazmgj.supabase.co/functions/v1/comicchat-mcp'
const consent = process.env.COMICCHAT_CONSENT_URL ||
  'https://comicchat-staging.vercel.app/oauth/consent'
const checks = []
async function check(label, fn) {
  try {
    const { ok, details } = await fn()
    checks.push({ label, ok, details })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${details}`)
  } catch (error) {
    checks.push({ label, ok: false, details: error?.message || String(error) })
    console.log(`FAIL ${label}: ${error?.message || String(error)}`)
  }
}
const timeout = 12000
const request = (url, options) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeout), ...options })
if (new URL(endpoint).protocol !== 'https:' || new URL(consent).protocol !== 'https:')
  throw Error('HTTPS is required for remote MCP and consent')
let metadata = null, issuer = null
await check('MCP access challenge', async () => {
  const response = await request(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'comicchat-readiness', version: '1' } } }),
  })
  const challenge = response.headers.get('www-authenticate') || ''
  const ok = response.status === 401 && challenge.includes('resource_metadata=')
  return { ok, details: `HTTP ${response.status}; protected-resource challenge ${ok ? 'present' : 'missing'}` }
})
await check('MCP protected-resource discovery', async () => {
  const url = new URL(endpoint); url.pathname = url.pathname.replace(/\/$/, '') + '/oauth-protected-resource'
  const response = await request(url)
  if (response.status === 200) {
    const data = await response.json()
    metadata = data
    issuer = data.authorization_servers?.[0]
    return { ok: data.resource === endpoint && typeof issuer === 'string',
      details: `HTTP 200; issuer ${issuer || 'missing'}` }
  }
  return { ok: false, details: `HTTP ${response.status}` }
})
await check('OAuth authorization-server discovery', async () => {
  if (!issuer) return { ok: false, details: 'missing issuer' }
  const location = new URL(issuer)
  const url = new URL('/.well-known/oauth-authorization-server' + location.pathname, location.origin)
  const response = await request(url)
  if (response.status !== 200) return { ok: false, details: `HTTP ${response.status}; OAuth discovery unavailable` }
  const data = await response.json()
  return { ok: typeof data.authorization_endpoint === 'string' && typeof data.token_endpoint === 'string',
    details: `HTTP 200; endpoints ${data.authorization_endpoint && data.token_endpoint ? 'present' : 'missing'}` }
})
await check('OAuth authorize route', async () => {
  if (!issuer) return { ok: false, details: 'missing issuer' }
  // Malformed client is intentional; a functioning server should reject it, not report route not found.
  const url = new URL(issuer.replace(/\/$/, '') + '/oauth/authorize')
  url.search = new URLSearchParams({ response_type: 'code',
    client_id: 'comicchat-readiness-invalid-client',
    redirect_uri: 'https://example.org/oauth-callback',
    code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    code_challenge_method: 'S256', scope: 'openid', state: 'readiness' }).toString()
  const response = await request(url)
  return { ok: ![404, 405, 500, 502, 503].includes(response.status),
    details: `HTTP ${response.status}; ${response.status === 404 ? 'OAuth authorize route unavailable' : 'route answered'}` }
})
await check('ComicChat consent page', async () => {
  const response = await request(consent)
  return { ok: response.status === 200, details: `HTTP ${response.status}` }
})
const failures = checks.filter(c => !c.ok)
console.log(`ComicChat remote MCP readiness: ${checks.length - failures.length}/${checks.length} passed`)
if (failures.length) {
  console.error('Release blocked: configure Supabase Authentication > OAuth Server and verify again.')
  process.exitCode = 1
}
