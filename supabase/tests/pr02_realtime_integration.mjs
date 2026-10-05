import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbUrl = process.env.DB_URL

if (!url || !anonKey || !serviceRoleKey || !dbUrl) {
  throw new Error(
    'SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and DB_URL are required'
  )
}

function dbScalar(sql) {
  return execFileSync(
    'psql',
    [dbUrl, '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql],
    { encoding: 'utf8' }
  ).trim()
}

const service = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 20 } },
})

const users = {
  a: {
    email: 'pr02-a@comicchat.local',
    password: 'ComicChat-A-Local-Only-2026!',
    username: 'alpha-pr02',
  },
  b: {
    email: 'pr02-b@comicchat.local',
    password: 'ComicChat-B-Local-Only-2026!',
    username: 'bravo-pr02',
  },
  c: {
    email: 'pr02-c@comicchat.local',
    password: 'ComicChat-C-Local-Only-2026!',
    username: 'charlie-pr02',
  },
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms)
    }),
  ])
}

async function probeUntilReceived(sendProbe, receivedPromise, label) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    sendProbe()

    const received = await Promise.race([
      receivedPromise.then(() => true),
      sleep(1000).then(() => false),
    ])

    if (received) {
      console.log(`${label}: ready after probe ${attempt}`)
      return
    }
  }

  throw new Error(`timeout waiting for ${label} after 12 probes`)
}

function createRealtimeClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  })
}

async function signIn(spec) {
  const client = createRealtimeClient()
  const { data, error } = await client.auth.signInWithPassword({
    email: spec.email,
    password: spec.password,
  })

  if (error) throw error
  if (!data.session?.access_token) throw new Error(`no session for ${spec.email}`)

  // The Node Realtime harness must explicitly attach the JWT before opening
  // RLS-protected postgres_changes channels. Browser auth wiring does this as
  // part of the application session lifecycle.
  await client.realtime.setAuth(data.session.access_token)

  return client
}

async function createUser(spec) {
  const { data, error } = await service.auth.admin.createUser({
    email: spec.email,
    password: spec.password,
    email_confirm: true,
  })

  if (error) throw error
  if (!data.user?.id) throw new Error(`no user id for ${spec.email}`)

  const { error: profileError } = await service.from('user').insert({
    id: data.user.id,
    username: spec.username,
    email: spec.email,
  })

  if (profileError) throw profileError
  return data.user.id
}

async function subscribe(channel, label) {
  await withTimeout(
    new Promise((resolve, reject) => {
      channel.subscribe((status, error) => {
        console.log(`${label}: ${status}`)
        if (status === 'SUBSCRIBED') resolve()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(error || new Error(`${label} subscription failed: ${status}`))
        }
      })
    }),
    10000,
    label
  )
}

async function expectSubscriptionRejected(channel, label) {
  await withTimeout(
    new Promise((resolve, reject) => {
      channel.subscribe((status, error) => {
        console.log(`${label}: ${status}`)
        if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          resolve(error || status)
        }
        if (status === 'SUBSCRIBED') {
          reject(new Error(`${label} unexpectedly subscribed`))
        }
      })
    }),
    10000,
    `${label} rejection`
  )
}

async function cleanupClient(client) {
  try {
    await client.removeAllChannels()
  } finally {
    await client.auth.signOut()
  }
}

const createdIds = []
let a
let b
let c

try {
  const aId = await createUser(users.a)
  const bId = await createUser(users.b)
  const cId = await createUser(users.c)
  createdIds.push(aId, bId, cId)

  a = await signIn(users.a)
  b = await signIn(users.b)
  c = await signIn(users.c)

  const { data: searchData, error: searchError } = await a.rpc('comic_search_users', {
    p_query: 'brav',
  })
  if (searchError) throw searchError
  if (searchData?.length !== 1 || searchData[0].user_id !== bId) {
    throw new Error('username discovery did not return only user B')
  }
  if ('email' in searchData[0]) {
    throw new Error('secure username discovery exposed email')
  }

  const { data: wildcardData, error: wildcardError } = await a.rpc('comic_search_users', {
    p_query: '%_',
  })
  if (wildcardError) throw wildcardError
  if ((wildcardData || []).length !== 0) {
    throw new Error('wildcard-like query unexpectedly enumerated users')
  }

  let bMembershipResolve
  const bMembershipPromise = new Promise((resolve) => {
    bMembershipResolve = resolve
  })
  let bControlResolve
  const bControlPromise = new Promise((resolve) => {
    bControlResolve = resolve
  })
  let cMembershipEvents = 0

  const bMembershipChannel = b
    .channel(`user:${bId}`, {
      config: { private: true },
    })
    .on('broadcast', { event: 'CONTROL' }, (payload) => {
      bControlResolve(payload)
    })
    .on('broadcast', { event: 'INSERT' }, (payload) => {
      bMembershipResolve(payload)
    })

  const cMembershipChannel = c
    .channel(`user:${cId}`, {
      config: { private: true },
    })
    .on('broadcast', { event: 'INSERT' }, () => {
      cMembershipEvents += 1
    })

  await Promise.all([
    subscribe(bMembershipChannel, 'B user Broadcast channel'),
    subscribe(cMembershipChannel, 'C user Broadcast channel'),
  ])

  // Realtime reports SUBSCRIBED before a freshly created local replication
  // slot is always ready to forward the first database Broadcast. Probe the
  // same private topic repeatedly and continue only after B receives one.
  // This hardens CI startup without weakening any authorization assertion.
  await probeUntilReceived(
    () =>
      dbScalar(
        `select realtime.send('{"control":true}'::jsonb, 'CONTROL', 'user:${bId}', true)`
      ),
    bControlPromise,
    'B control DB Broadcast'
  )

  const realtimeRowsBeforeEnsure = Number(
    dbScalar('select count(*) from realtime.messages')
  )

  const { data: conversationId, error: ensureError } = await a.rpc(
    'comic_ensure_direct_conversation',
    { partner_id: bId }
  )
  if (ensureError) throw ensureError
  if (!conversationId) throw new Error('conversation id missing')

  const { data: bMembershipRows, error: bMembershipReadError } = await b
    .from('comic_membership')
    .select('conversation_id, user_id, role')
    .eq('conversation_id', conversationId)
  if (bMembershipReadError) throw bMembershipReadError
  console.log('B membership rows after ensure:', bMembershipRows)
  if (
    bMembershipRows?.length !== 1 ||
    bMembershipRows[0].user_id !== bId
  ) {
    throw new Error('B cannot read exactly its own membership row through JWT/RLS')
  }

  const { data: cMembershipRows, error: cMembershipReadError } = await c
    .from('comic_membership')
    .select('conversation_id, user_id, role')
    .eq('conversation_id', conversationId)
  if (cMembershipReadError) throw cMembershipReadError
  console.log('C membership rows after ensure:', cMembershipRows)
  if ((cMembershipRows || []).length !== 0) {
    throw new Error('C can read another user membership row through JWT/RLS')
  }

  const realtimeRowsAfterEnsure = Number(
    dbScalar('select count(*) from realtime.messages')
  )
  if (realtimeRowsAfterEnsure < realtimeRowsBeforeEnsure + 2) {
    throw new Error(
      'membership triggers did not write both private Broadcast messages'
    )
  }

  await withTimeout(
    bMembershipPromise,
    10000,
    'B private membership Broadcast'
  )

  await sleep(1200)
  if (cMembershipEvents !== 0) {
    throw new Error('non-member C received another user membership event')
  }

  const { data: bList, error: bListError } = await b.rpc(
    'comic_list_direct_conversations'
  )
  if (bListError) throw bListError
  if (!bList?.some((row) => row.conversation_id === conversationId)) {
    throw new Error('B cannot list newly created direct conversation')
  }

  let bMessageResolve
  const bMessagePromise = new Promise((resolve) => {
    bMessageResolve = resolve
  })

  const bMessageChannel = b
    .channel(`conversation:${conversationId}`, {
      config: { private: true },
    })
    .on('broadcast', { event: 'INSERT' }, (payload) => {
      bMessageResolve(payload)
    })

  const cMessageChannel = c.channel(`conversation:${conversationId}`, {
    config: { private: true },
  })

  await subscribe(bMessageChannel, 'B private conversation Broadcast channel')
  await expectSubscriptionRejected(
    cMessageChannel,
    'C forbidden conversation Broadcast channel'
  )

  const nonce = crypto.randomUUID()
  const { data: firstSend, error: firstSendError } = await a.rpc(
    'comic_send_message',
    {
      p_conversation_id: conversationId,
      p_client_nonce: nonce,
      p_original_text: 'Hello from A',
    }
  )
  if (firstSendError) throw firstSendError

  const firstMessage = Array.isArray(firstSend) ? firstSend[0] : firstSend
  if (!firstMessage?.id) throw new Error('first message id missing')

  await withTimeout(
    bMessagePromise,
    10000,
    'B private message Broadcast'
  )

  const { data: bFirstHistory, error: bFirstHistoryError } = await b
    .from('comic_message')
    .select('id, client_nonce, original_text')
    .eq('conversation_id', conversationId)
    .eq('id', firstMessage.id)
  if (bFirstHistoryError) throw bFirstHistoryError
  if (bFirstHistory?.length !== 1) {
    throw new Error('B received Broadcast but cannot resolve the persistent message row')
  }

  const { data: duplicateSend, error: duplicateError } = await a.rpc(
    'comic_send_message',
    {
      p_conversation_id: conversationId,
      p_client_nonce: nonce,
      p_original_text: 'Hello from A',
    }
  )
  if (duplicateError) throw duplicateError

  const duplicateMessage = Array.isArray(duplicateSend)
    ? duplicateSend[0]
    : duplicateSend
  if (duplicateMessage?.id !== firstMessage.id) {
    throw new Error('same client nonce created a second logical message')
  }

  const { error: nonceConflict } = await a.rpc('comic_send_message', {
    p_conversation_id: conversationId,
    p_client_nonce: nonce,
    p_original_text: 'Changed text must conflict',
  })
  if (!nonceConflict) {
    throw new Error('same nonce with changed source text was accepted')
  }

  await b.removeChannel(bMessageChannel)

  const secondNonce = crypto.randomUUID()
  const { data: secondSend, error: secondSendError } = await a.rpc(
    'comic_send_message',
    {
      p_conversation_id: conversationId,
      p_client_nonce: secondNonce,
      p_original_text: 'Message while B is disconnected',
    }
  )
  if (secondSendError) throw secondSendError
  const secondMessage = Array.isArray(secondSend) ? secondSend[0] : secondSend

  const reconnectedChannel = b
    .channel(`conversation:${conversationId}`, {
      config: { private: true },
    })
    .on('broadcast', { event: 'INSERT' }, () => {})
  await subscribe(reconnectedChannel, 'B reconnected private conversation channel')

  const { data: history, error: historyError } = await b
    .from('comic_message')
    .select('id, client_nonce, original_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (historyError) throw historyError
  if (history?.length !== 2) {
    throw new Error(`reconnect history expected 2 messages, got ${history?.length}`)
  }

  const historyIds = new Set(history.map((row) => row.id))
  if (
    !historyIds.has(firstMessage.id) ||
    !historyIds.has(secondMessage.id) ||
    historyIds.size !== 2
  ) {
    throw new Error('reconnect history is duplicated or missing persistent ids')
  }

  const { data: cHistory, error: cHistoryError } = await c
    .from('comic_message')
    .select('id')
    .eq('conversation_id', conversationId)

  if (cHistoryError) throw cHistoryError
  if ((cHistory || []).length !== 0) {
    throw new Error('non-member C can read private conversation history')
  }

  const { error: cSendError } = await c.rpc('comic_send_message', {
    p_conversation_id: conversationId,
    p_client_nonce: crypto.randomUUID(),
    p_original_text: 'C must not send here',
  })
  if (!cSendError) {
    throw new Error('non-member C can send into private conversation')
  }

  const { error: readError } = await b.rpc('comic_mark_conversation_read', {
    p_conversation_id: conversationId,
  })
  if (readError) throw readError

  const { data: receipts, error: receiptError } = await b
    .from('comic_message_receipt')
    .select('message_id, user_id, delivered_at, read_at')
    .eq('conversation_id', conversationId)

  if (receiptError) throw receiptError
  if (
    receipts?.length !== 2 ||
    receipts.some(
      (row) => row.user_id !== bId || !row.delivered_at || !row.read_at
    )
  ) {
    throw new Error('B read receipts were not restricted to B')
  }

  const { error: cReadError } = await c.rpc('comic_mark_conversation_read', {
    p_conversation_id: conversationId,
  })
  if (!cReadError) {
    throw new Error('non-member C can mutate private conversation receipts')
  }

  await Promise.all([
    b.removeChannel(bMembershipChannel),
    c.removeChannel(cMembershipChannel),
    c.removeChannel(cMessageChannel),
    b.removeChannel(reconnectedChannel),
  ])

  console.log(
    'PR-02 local Supabase Auth + Realtime + reconnect integration checks passed.'
  )
} finally {
  await Promise.all(
    [a, b, c].filter(Boolean).map((client) => cleanupClient(client))
  )

  for (const id of createdIds) {
    await service.auth.admin.deleteUser(id)
  }

  await service.removeAllChannels()
}
