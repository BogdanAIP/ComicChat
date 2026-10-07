import { execFileSync } from 'node:child_process'

const supabaseUrl = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const dbUrl = process.env.DB_URL

if (!supabaseUrl || !anonKey || !dbUrl) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and DB_URL are required')
}

const mcpUrl =
  process.env.COMICCHAT_MCP_URL ||
  `${supabaseUrl.replace(/\/$/, '')}/functions/v1/comicchat-mcp`

const users = {
  a: { email: 'pr23-a@comicchat.local', username: 'pr23-alpha' },
  b: { email: 'pr23-b@comicchat.local', username: 'pr23-bravo' },
  c: { email: 'pr23-c@comicchat.local', username: 'pr23-charlie' },
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
    throw new Error(`${label} failed (${response.status}): ${raw}`)
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

async function createAndSignIn(spec) {
  const password = `Pr23-${crypto.randomUUID()}-Aa1!`

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
    throw new Error(`sign-in response missing access token for ${spec.email}`)
  }

  return { id, token: login.access_token }
}

function parseMcpEnvelope(raw, expectedId) {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('MCP response body was empty')

  if (trimmed.startsWith('{')) {
    const value = JSON.parse(trimmed)
    if (value.id !== expectedId) {
      throw new Error(`MCP JSON response id mismatch: ${value.id} !== ${expectedId}`)
    }
    return value
  }

  const candidates = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue

    try {
      candidates.push(JSON.parse(data))
    } catch {
      // Ignore unrelated SSE lines. The MCP result event is JSON.
    }
  }

  const match = candidates.find((item) => item?.id === expectedId)
  if (!match) {
    throw new Error(`MCP SSE response missing expected request id ${expectedId}`)
  }
  return match
}

let rpcId = 0

async function callTool(token, name, args = {}) {
  rpcId += 1
  const id = `pr23-${rpcId}`

  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })

  const raw = await response.text()
  if (response.status !== 200) {
    throw new Error(`MCP ${name} transport failed (${response.status})`)
  }

  const envelope = parseMcpEnvelope(raw, id)
  return {
    result: envelope.result || null,
    rpcError: envelope.error || null,
  }
}

function toolText(call) {
  const result = call.result
  return (result?.content || [])
    .filter((item) => item?.type === 'text')
    .map((item) => String(item.text || ''))
    .join('\n')
}

function toolData(call) {
  const result = call.result
  if (result?.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent
  }

  const text = toolText(call)
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function expectSuccess(call, label) {
  if (call.rpcError || call.result?.isError) {
    throw new Error(
      `${label} unexpectedly failed: ${call.rpcError?.message || toolText(call)}`
    )
  }
}

function expectError(call, marker, privateText, label) {
  if (!call.rpcError && !call.result?.isError) {
    throw new Error(`${label} unexpectedly succeeded`)
  }

  const text = [call.rpcError?.message || '', toolText(call)].join('\n')
  if (!text.includes(marker)) {
    throw new Error(`${label} missing error marker ${marker}: ${text}`)
  }
  if (privateText && text.includes(privateText)) {
    throw new Error(`${label} leaked private message text`)
  }
}

const accounts = {}
for (const [key, spec] of Object.entries(users)) {
  accounts[key] = await createAndSignIn(spec)
}

for (const key of Object.keys(users)) {
  const call = await callTool(accounts[key].token, 'comicchat_profile')
  expectSuccess(call, `${key} profile`)
  const profile = toolData(call)

  if (profile?.id !== accounts[key].id) {
    throw new Error(`${key} MCP profile resolved the wrong authenticated identity`)
  }

  for (const other of Object.keys(users)) {
    if (other !== key && profile?.id === accounts[other].id) {
      throw new Error(`${key} profile crossed into ${other} identity`)
    }
  }
}

const findB = await callTool(accounts.a.token, 'find_users', {
  query: users.b.username,
})
expectSuccess(findB, 'A find B')
const foundUsers = toolData(findB)?.users || []

if (
  foundUsers.length !== 1 ||
  foundUsers[0]?.user_id !== accounts.b.id ||
  foundUsers[0]?.username !== users.b.username
) {
  throw new Error(`A did not discover exactly B: ${JSON.stringify(foundUsers)}`)
}
if ('email' in foundUsers[0]) {
  throw new Error('find_users exposed B email through MCP')
}

const opened = await callTool(accounts.a.token, 'open_direct_conversation', {
  partnerId: accounts.b.id,
})
expectSuccess(opened, 'A open B conversation')
const conversationId = toolData(opened)?.conversationId
if (!conversationId) throw new Error('MCP open_direct_conversation returned no id')

const privateText = 'PR23 private A-B transport isolation'
const sent = await callTool(accounts.a.token, 'send_message', {
  conversationId,
  requestId: crypto.randomUUID(),
  text: privateText,
})
expectSuccess(sent, 'A send A-B message')
const message = toolData(sent)?.message
if (!message?.id || message.original_text !== privateText) {
  throw new Error('MCP send_message returned an unexpected message')
}

const bList = await callTool(accounts.b.token, 'list_conversations', { limit: 20 })
expectSuccess(bList, 'B list conversations')
if (
  !(toolData(bList)?.conversations || []).some(
    (row) => row.conversation_id === conversationId
  )
) {
  throw new Error('B cannot see A-B conversation through MCP')
}

const cList = await callTool(accounts.c.token, 'list_conversations', { limit: 20 })
expectSuccess(cList, 'C list conversations')
if (
  (toolData(cList)?.conversations || []).some(
    (row) => row.conversation_id === conversationId
  )
) {
  throw new Error('C can enumerate A-B conversation through MCP')
}

const bMessages = await callTool(accounts.b.token, 'get_messages', {
  conversationId,
  limit: 30,
})
expectSuccess(bMessages, 'B read A-B messages')
if (
  !(toolData(bMessages)?.messages || []).some(
    (row) => row.id === message.id && row.original_text === privateText
  )
) {
  throw new Error('B cannot read A private message through MCP')
}

const cMessages = await callTool(accounts.c.token, 'get_messages', {
  conversationId,
  limit: 30,
})
expectError(cMessages, 'conversation_forbidden', privateText, 'C read A-B messages')

const cFocusedApp = await callTool(accounts.c.token, 'open_comicchat_app', {
  conversationId,
})
expectError(
  cFocusedApp,
  'conversation_forbidden',
  privateText,
  'C focus A-B conversation'
)

const cSend = await callTool(accounts.c.token, 'send_message', {
  conversationId,
  requestId: crypto.randomUUID(),
  text: 'C must not enter A-B',
})
expectError(cSend, 'conversation_forbidden', privateText, 'C send into A-B')

const aExport = await callTool(accounts.a.token, 'export_my_data')
expectSuccess(aExport, 'A export')
const aExportText = JSON.stringify(toolData(aExport)?.export)
if (!aExportText.includes(conversationId) || !aExportText.includes(privateText)) {
  throw new Error('A export is missing authorized A-B data')
}

const cExport = await callTool(accounts.c.token, 'export_my_data')
expectSuccess(cExport, 'C export')
const cExportText = JSON.stringify(toolData(cExport)?.export)
if (cExportText.includes(conversationId) || cExportText.includes(privateText)) {
  throw new Error('C export leaked A-B conversation data')
}

for (const key of ['a', 'c']) {
  const safety = await callTool(accounts[key].token, 'get_beta_safety_status')
  expectSuccess(safety, `${key} beta safety status`)
  const status = toolData(safety)?.status

  if (
    status?.stage !== 'closed_beta' ||
    status?.generation_provider !== 'mock' ||
    status?.public_publication_enabled !== false
  ) {
    throw new Error(`${key} received unexpected beta safety state`)
  }
}

console.log('PR-23 authenticated MCP two-account isolation checks passed.')
