import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required')
}

const service = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const users = {
  a: { email: 'pr18-a@comicchat.local', password: 'ComicChat-PR18-A-2026!', username: 'pr18-alpha' },
  b: { email: 'pr18-b@comicchat.local', password: 'ComicChat-PR18-B-2026!', username: 'pr18-bravo' },
  c: { email: 'pr18-c@comicchat.local', password: 'ComicChat-PR18-C-2026!', username: 'pr18-charlie' },
}

function client() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  })
}

async function createUser(spec) {
  const { data, error } = await service.auth.admin.createUser({
    email: spec.email,
    password: spec.password,
    email_confirm: true,
  })
  if (error) throw error
  const id = data.user?.id
  if (!id) throw new Error('created user missing id')
  const { error: profileError } = await service.from('user').insert({
    id,
    username: spec.username,
    email: spec.email,
  })
  if (profileError) throw profileError
  return id
}

async function signIn(spec) {
  const c = client()
  const { data, error } = await c.auth.signInWithPassword({
    email: spec.email,
    password: spec.password,
  })
  if (error) throw error
  await c.realtime.setAuth(data.session.access_token)
  return c
}

function timeout(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)
  )
}

async function subscribeAllowed(channel, label) {
  await Promise.race([
    new Promise((resolve, reject) => {
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') resolve()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          reject(error || new Error(`${label}: ${status}`))
        }
      })
    }),
    timeout(10000, label),
  ])
}

async function subscribeRejected(channel, label) {
  await Promise.race([
    new Promise((resolve, reject) => {
      channel.subscribe((status, error) => {
        if (status === 'SUBSCRIBED') reject(new Error(`${label} unexpectedly subscribed`))
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          resolve(error || status)
        }
      })
    }),
    timeout(10000, label),
  ])
}

const ids = []
let a
let b
let c
let anonymous

try {
  const aId = await createUser(users.a)
  const bId = await createUser(users.b)
  const cId = await createUser(users.c)
  ids.push(aId, bId, cId)

  a = await signIn(users.a)
  b = await signIn(users.b)
  c = await signIn(users.c)
  anonymous = client()

  const { data: conversationId, error } = await a.rpc('comic_ensure_direct_conversation', {
    partner_id: bId,
  })
  if (error) throw error

  const foreignUserTopic = c.channel(`user:${bId}`, { config: { private: true } })
  const foreignConversation = c.channel(`conversation:${conversationId}`, {
    config: { private: true },
  })
  const unknownConversation = c.channel(
    'conversation:18181818-dddd-4ddd-8ddd-dddddddddddd',
    { config: { private: true } }
  )
  const anonymousConversation = anonymous.channel(`conversation:${conversationId}`, {
    config: { private: true },
  })

  await subscribeRejected(foreignUserTopic, 'foreign user topic')
  await subscribeRejected(foreignConversation, 'foreign conversation topic')
  await subscribeRejected(unknownConversation, 'unknown conversation topic')
  await subscribeRejected(anonymousConversation, 'anonymous private conversation topic')

  const ownConversation = a.channel(`conversation:${conversationId}`, {
    config: { private: true },
  })
  await subscribeAllowed(ownConversation, 'member conversation topic')

  const sendStatus = await ownConversation.send({
    type: 'broadcast',
    event: 'CLIENT_INJECT',
    payload: { should_not_be_accepted: true },
  })
  if (sendStatus === 'ok') {
    throw new Error('authenticated client unexpectedly sent a private ComicChat Broadcast')
  }

  console.log('PR-18 Realtime negative-security matrix passed.')
} finally {
  for (const c0 of [a, b, c, anonymous].filter(Boolean)) {
    try { await c0.removeAllChannels() } catch {}
    try { await c0.auth.signOut() } catch {}
  }
  for (const id of ids) {
    try { await service.auth.admin.deleteUser(id) } catch {}
  }
  await service.removeAllChannels()
}
