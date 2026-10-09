// ComicChat PR-25: opt-in private comic image renderer.
//
// The browser authenticates as the message sender. A trusted service-role
// client claims only that exact sender-owned GenerationJob, calls the official
// OpenAI Images SDK, stores image bytes in a private Supabase bucket, then
// completes the existing job/ledger record.
//
// No provider URL is exposed. Exact message text stays in comic_message and is
// overlaid by the web UI; the image prompt explicitly requests artwork without
// letters, captions, or speech bubbles.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import { claimAndRenderMessage } from '../_shared/comic-image-worker.ts'
const PROVIDER = 'openai-image'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(value: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'server_not_configured' }, 503)
  }

  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return json({ error: 'not_authenticated' }, 401)
  }

  let body: { messageId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_request' }, 400)
  }

  const messageId = typeof body.messageId === 'string' ? body.messageId : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
    return json({ error: 'invalid_message_id' }, 400)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) {
    return json({ error: 'not_authenticated' }, 401)
  }

  // Sender-only RLS on comic_generation_job means a conversation partner
  // cannot trigger somebody else's provider spend.
  const { data: job, error: jobError } = await userClient
    .from('comic_generation_job')
    .select('id, message_id, sender_id, provider, status')
    .eq('message_id', messageId)
    .maybeSingle()

  if (jobError || !job || job.sender_id !== authData.user.id) {
    return json({ error: 'generation_job_not_found' }, 404)
  }

  if (job.provider !== PROVIDER) {
    return json({ accepted: false, status: 'provider_not_applicable' })
  }

  if (job.status === 'ready') {
    return json({ accepted: false, status: 'ready' })
  }

  if (job.status === 'failed') {
    return json({ accepted: false, status: 'failed' }, 409)
  }

  // Exact claim owns lease recovery. A rendering hint must reach that
  // transition too; an active lease remains a no-op in the database.

  EdgeRuntime.waitUntil(
    claimAndRenderMessage({
      messageId,
      supabaseUrl,
      serviceRoleKey,
    })
  )

  return json({ accepted: true, status: 'queued' }, 202)
})
