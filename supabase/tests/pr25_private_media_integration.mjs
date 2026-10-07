import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbUrl = process.env.DB_URL

if (!supabaseUrl || !anonKey || !serviceRoleKey || !dbUrl) {
  throw new Error(
    'SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and DB_URL are required'
  )
}

const specs = {
  a: { email: 'pr25-a@comicchat.local', username: 'pr25-alpha' },
  b: { email: 'pr25-b@comicchat.local', username: 'pr25-bravo' },
  c: { email: 'pr25-c@comicchat.local', username: 'pr25-charlie' },
}

async function requestJson(url, init, label) {
  const response = await fetch(url, init)
  const raw = await response.text()
  let body = null

  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      throw new Error(`${label} returned non-JSON body (${response.status})`)
    }
  }

  if (!response.ok) {
    throw new Error(`${label} failed (${response.status})`)
  }

  return body
}

function insertProfile(id, spec) {
  const sql = [
    'INSERT INTO public."user"(id, username, email)',
    `VALUES ('${id}'::uuid, '${spec.username}', '${spec.email}');`,
  ].join(' ')

  execFileSync(
    'psql',
    [dbUrl, '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
}

async function createUser(spec) {
  const password = `Pr25-${crypto.randomUUID()}-Aa1!`
  const signup = await requestJson(
    `${supabaseUrl}/auth/v1/signup`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: spec.email, password }),
    },
    `sign up ${spec.email}`
  )

  const id = signup?.user?.id
  if (!id) throw new Error(`signup response missing user id for ${spec.email}`)
  insertProfile(id, spec)

  const login = await requestJson(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: spec.email, password }),
    },
    `sign in ${spec.email}`
  )

  if (!login?.access_token) {
    throw new Error(`sign-in response missing token for ${spec.email}`)
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: `Bearer ${login.access_token}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return { id, token: login.access_token, client }
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const anonymous = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const [a, b, c] = await Promise.all([
  createUser(specs.a),
  createUser(specs.b),
  createUser(specs.c),
])

const { data: conversationId, error: conversationError } = await a.client.rpc(
  'comic_ensure_direct_conversation',
  { partner_id: b.id }
)
if (conversationError || !conversationId) {
  throw new Error('could not create PR-25 conversation')
}

const { data: sentRows, error: sendError } = await a.client.rpc('comic_send_message', {
  p_conversation_id: conversationId,
  p_client_nonce: crypto.randomUUID(),
  p_original_text: 'private art authorization probe',
})
if (sendError) throw new Error('could not create PR-25 message')
const message = Array.isArray(sentRows) ? sentRows[0] : sentRows
if (!message?.id) throw new Error('PR-25 send returned no message')

const bucket = await service.storage.getBucket('comicchat-art')
if (bucket.error || !bucket.data) throw new Error('private comicchat-art bucket missing')
if (bucket.data.public !== false) throw new Error('comicchat-art bucket must remain private')

const objectPath = `${conversationId}/${message.id}.webp`
const payload = new TextEncoder().encode('pr25-private-art-probe')

const upload = await service.storage.from('comicchat-art').upload(objectPath, payload, {
  contentType: 'image/webp',
  upsert: true,
})
if (upload.error) throw new Error('service-role private art upload failed')

const aDownload = await a.client.storage.from('comicchat-art').download(objectPath)
if (aDownload.error || !aDownload.data) {
  throw new Error('sender could not download private comic art')
}

const bDownload = await b.client.storage.from('comicchat-art').download(objectPath)
if (bDownload.error || !bDownload.data) {
  throw new Error('conversation partner could not download private comic art')
}

const decoded = await bDownload.data.text()
if (decoded !== 'pr25-private-art-probe') {
  throw new Error('authorized private comic art bytes changed')
}

const cDownload = await c.client.storage.from('comicchat-art').download(objectPath)
if (!cDownload.error) {
  throw new Error('foreign authenticated user unexpectedly downloaded private comic art')
}

const anonymousDownload = await anonymous.storage.from('comicchat-art').download(objectPath)
if (!anonymousDownload.error) {
  throw new Error('anonymous caller unexpectedly downloaded private comic art')
}

const browserUpload = await a.client.storage
  .from('comicchat-art')
  .upload(`${conversationId}/browser-write.webp`, payload, {
    contentType: 'image/webp',
  })
if (!browserUpload.error) {
  throw new Error('authenticated browser unexpectedly uploaded private comic art')
}

const { data: capabilityRows, error: capabilityError } = await a.client.rpc(
  'comic_get_media_capabilities'
)
if (capabilityError) throw new Error('media capability RPC failed')
const capabilities = Array.isArray(capabilityRows) ? capabilityRows[0] : capabilityRows
if (
  !capabilities ||
  capabilities.client_upload_enabled !== false ||
  capabilities.private_asset_storage_enabled !== true ||
  capabilities.signed_asset_access_enabled !== false ||
  capabilities.public_asset_urls_enabled !== false ||
  capabilities.active_media_provider !== 'supabase-private'
) {
  throw new Error('private media capabilities do not match PR-25 contract')
}

console.log('PR-25 private Supabase media authorization passed.')
