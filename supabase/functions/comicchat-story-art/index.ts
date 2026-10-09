import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.109.0'

const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
function fail(status: number) {
  return new Response(JSON.stringify({ error: status === 401 ? 'not_authenticated' : 'art_unavailable' }), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405)
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return fail(503)
  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return fail(401)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false } })
  const { data: auth, error: authError } = await userClient.auth.getUser()
  if (authError || !auth.user) return fail(401)
  let body
  try { body = await req.json() } catch { return fail(400) }
  if (!['direct', 'group'].includes(body?.episodeKind) ||
    typeof body?.episodeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.episodeId) ||
    !Number.isInteger(body?.panelIndex) || body.panelIndex < 0 || body.panelIndex >= 36) return fail(400)
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  // The resolver checks CURRENT direct consent, public group eligibility, or
  // closed-group membership. Its private path never enters the client response.
  const { data, error } = await service.rpc('comic_resolve_episode_asset', {
    p_episode_kind: body.episodeKind, p_episode_id: body.episodeId,
    p_panel_index: body.panelIndex, p_viewer_id: auth.user.id,
  })
  const asset = Array.isArray(data) ? data[0] : data
  if (error || !asset?.object_path) return fail(404)
  const { data: blob, error: downloadError } = await service.storage.from('comicchat-art').download(asset.object_path)
  if (downloadError || !blob) return fail(404)
  return new Response(blob, { headers: { ...cors, 'Content-Type': 'image/webp',
    'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } })
})
