import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import { imageMime, readChatGptFile } from './chatgpt-art-validation.mjs'
export { readChatGptFile }
const MAX_BYTES = 8 * 1024 * 1024
export async function attachChatGptArt(userClient: any, messageId: string, bytes: Uint8Array) {
  const mime = imageMime(bytes)
  if (!mime || bytes.length > MAX_BYTES) throw new Error('invalid_illustration')
  const { data: auth, error: authError } = await userClient.auth.getUser()
  if (authError || !auth.user) throw new Error('not_authenticated')
  const { data: messages, error } = await userClient.rpc('comic_read_message', { p_message_id: messageId })
  const msg = Array.isArray(messages) ? messages[0] : messages
  if (error || !msg || msg.sender_id !== auth.user.id) throw new Error('message_unavailable')
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const assetId = crypto.randomUUID()
  // This suffix is the existing private asset locator contract. Content-Type
  // records the actual PNG/JPEG/WebP bytes; readers consume a Blob, not a codec assumption.
  const path = msg.conversation_id + '/' + msg.id + '/' + assetId + '.webp'
  const { error: uploadError } = await service.storage.from('comicchat-art').upload(path, bytes,
    { contentType: mime, upsert: false, cacheControl: '0' })
  if (uploadError) throw new Error('illustration_upload_failed')
  const { error: commitError } = await service.rpc('comic_commit_chatgpt_art', {
    p_actor_id: auth.user.id, p_message_id: msg.id, p_asset_id: assetId, p_mime_type: mime,
  })
  if (commitError) {
    await service.storage.from('comicchat-art').remove([path])
    throw new Error('illustration_commit_failed')
  }
  return { messageId: msg.id, assetId, status: 'ready' }
}
export async function readPrivateChatGptArt(userClient: any, messageId: string, expectedAssetId: string) {
  const { data: rows, error } = await userClient.rpc('comic_read_message', { p_message_id: messageId })
  const msg = Array.isArray(rows) ? rows[0] : rows
  if (error || !msg?.media_asset_id || msg.media_asset_id !== expectedAssetId) throw new Error('message_unavailable')
  const assetId = msg.media_asset_id
  const path = assetId === msg.id ? msg.conversation_id + '/' + msg.id + '.webp'
    : msg.conversation_id + '/' + msg.id + '/' + assetId + '.webp'
  const { data, error: downloadError } = await userClient.storage.from('comicchat-art').download(path)
  if (downloadError || !data || data.size > MAX_BYTES) throw new Error('illustration_unavailable')
  return data
}
