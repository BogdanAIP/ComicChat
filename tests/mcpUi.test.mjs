import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { createMcpClient } from '../mcp-ui/client.mjs'
import { makeOperationSchemas } from '../supabase/functions/comicchat-mcp/operations.mjs'
const schemas = makeOperationSchemas(z)
const id = '06642244-7e05-4567-8763-dae5c939b565'
test('app capabilities reject arbitrary RPCs and identity overrides', () => {
  for (const request of [
    { operation: 'execute_sql', args: { query: 'select 1' } },
    { operation: 'comic_send_message', args: {
      p_conversation_id: id, p_client_nonce: id, p_original_text: 'hello', sender_id: id } },
    { operation: 'comic_join_group', args: { p_group_id: 'invented', p_accept_public_reuse: false } },
  ]) assert.equal(schemas.write.safeParse(request).success, false)
  assert.equal(schemas.read.safeParse({ operation: 'comic_leave_group', args: { p_group_id: id } }).success, false)
})
test('group and style parameters match existing database contracts', () => {
  assert.equal(schemas.write.safeParse({ operation: 'comic_join_group',
    args: { p_group_id: id, p_accept_public_reuse: false } }).success, true)
  assert.equal(schemas.write.safeParse({ operation: 'comic_set_conversation_style',
    args: { p_conversation_id: id, p_primary_style_id: 'anime',
      p_secondary_style_id: 'manga', p_secondary_weight: 40 } }).success, true)
  assert.equal(schemas.write.safeParse({ operation: 'comic_report_message',
    args: { p_message_id: id, p_client_nonce: id, p_reason: 'sexual_content' } }).success, true)
})
test('adapter uses host tools and preserves retry nonce and exact message text', async () => {
  const calls = []
  const client = createMcpClient(async request => {
    calls.push(request); return { structuredContent: { data: [{ id }] } }
  }, { id })
  const args = { p_conversation_id: id, p_client_nonce: id, p_original_text: '  Exact text\nПривет  ' }
  for (let i = 0; i < 2; i++) assert.equal((await client.rpc('comic_send_message', args)).error, null)
  assert.deepEqual(calls[0], calls[1])
  assert.equal(calls[0].arguments.request.args.p_original_text, args.p_original_text)
  assert.equal(calls[0].name, 'comicchat_ui_write')
  const before = calls.length
  assert.ok((await client.rpc('execute_sql')).error)
  assert.equal(calls.length, before)
  assert.equal(client.realtime, undefined)
})
test('tool failures remain failures and never appear as successful empty data', async () => {
  const client = createMcpClient(async () => ({ isError: true,
    content: [{ type: 'text', text: 'conversation_unavailable' }] }), { id })
  const result = await client.rpc('comic_read_message_page', { p_conversation_id: id, p_limit: 50 })
  assert.equal(result.data, null)
  assert.match(result.error.message, /conversation_unavailable/)
})
test('profile facade cannot update another account or another column', async () => {
  let count = 0
  const client = createMcpClient(async () => { count++; return { structuredContent: { data: { id, username: 'Alpha' } } } }, { id })
  assert.ok((await client.from('user').update({ username: 'x' }).eq('id', 'other')).error)
  assert.ok((await client.from('user').update({ email: 'x' }).eq('id', id)).error)
  assert.equal(count, 0)
  assert.equal((await client.from('user').update({ username: 'Alpha' }).eq('id', id)).error, null)
  assert.equal(count, 1)
  assert.ok((await client.auth.signOut()).error)
})

test('preferences are self-only and accept only known locales and themes',()=>{
  assert.equal(schemas.write.safeParse({operation:'comic_set_my_preferences',args:{p_locale:'ru',p_theme:'manga'}}).success,true)
  for(const args of [{p_locale:'ru',p_theme:'invented'},{p_locale:'xx',p_theme:'classic'},{p_locale:'ru',p_theme:'classic',user_id:id}])
    assert.equal(schemas.write.safeParse({operation:'comic_set_my_preferences',args}).success,false)
  assert.equal(schemas.read.safeParse({operation:'comic_list_message_styles',args:{p_conversation_id:id}}).success,true)
})
test('private asset adapter exposes bytes only to UI and does not accept another bucket',async()=>{
  const calls=[]
  const client=createMcpClient(async request=>{calls.push(request);return {_meta:{imageBase64:btoa('test'),mimeType:'image/webp'}}},{id})
  assert.ok((await client.storage.from('other').download(id+'/'+id+'.webp')).error)
  assert.equal(calls.length,0)
  const result=await client.storage.from('comicchat-art').download(id+'/'+id+'/'+id+'.webp')
  assert.ok(result.data instanceof Blob)
  assert.deepEqual(calls[0].arguments,{accountId:id,messageId:id,assetId:id})
})
