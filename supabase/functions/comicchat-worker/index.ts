import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import { renderClaimedJob } from '../_shared/comic-image-worker.ts'

function response(status: number, value: Record<string, unknown>) {
  return new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
function matchesSecret(actual: string, expected: string) {
  if (actual.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  return difference === 0
}
async function drain(supabaseUrl: string, serviceRoleKey: string) {
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: config, error } = await service.from('comic_generation_config')
    .select('provider,external_generation_enabled').eq('singleton_id', 1).single()
  if (error || !config) return
  // Native mock/template processing costs nothing and also finishes while the
  // browser is closed. Paid work requires the existing explicit provider gate.
  for (let index = 0; index < 8; index += 1) {
    const { data, error: claimError } = await service.rpc('comic_claim_generation_job', {
      p_provider: 'mock', p_lease_seconds: 180,
    })
    const claimed = Array.isArray(data) ? data[0] : data
    if (claimError || !claimed?.id) break
    await renderClaimedJob({ supabaseUrl, serviceRoleKey, claimed })
  }
  if (!config.external_generation_enabled || config.provider !== 'openai-image') return
  const jobs = []
  for (let index = 0; index < 2; index += 1) {
    const { data, error: claimError } = await service.rpc('comic_claim_generation_job', {
      p_provider: 'openai-image', p_lease_seconds: 180,
    })
    const claimed = Array.isArray(data) ? data[0] : data
    if (claimError || !claimed?.id) break
    jobs.push(renderClaimedJob({ supabaseUrl, serviceRoleKey, claimed }))
  }
  await Promise.allSettled(jobs)
}
Deno.serve(async (req) => {
  if (req.method !== 'POST') return response(405, { error: 'method_not_allowed' })
  const secret = Deno.env.get('COMICCHAT_WORKER_SECRET')
  const actual = req.headers.get('Authorization')?.replace(/^Bearer /, '') || ''
  if (!actual || actual.length < 32 || actual.length > 512) return response(401, { error: 'not_authenticated' })
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return response(503, { error: 'server_not_configured' })
  if (secret) {
    if (!matchesSecret(actual, secret)) return response(401, { error: 'not_authenticated' })
  } else {
    // Hosted setup reuses Supabase Vault for the dedicated cron credential.
    // Only this service client can validate it; no credential is returned.
    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: valid, error } = await service.rpc('comic_validate_worker_secret', { p_secret: actual })
    if (error || valid !== true) return response(401, { error: 'not_authenticated' })
  }
  EdgeRuntime.waitUntil(drain(url, serviceKey).catch(() => { console.error('comicchat-worker drain failed') }))
  return response(202, { accepted: true })
})
