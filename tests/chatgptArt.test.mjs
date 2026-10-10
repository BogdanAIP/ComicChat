import test from 'node:test'
import assert from 'node:assert/strict'
import { imageMime, isChatGptFileUrl, readChatGptFile, MAX_IMAGE_BYTES } from '../supabase/functions/_shared/chatgpt-art-validation.mjs'
test('file download cannot target internal services or follow a redirect', async()=>{
  for(const url of ['http://files.oaiusercontent.com/x','https://127.0.0.1/x','https://files.oaiusercontent.com.evil.example/x','https://u:p@files.oaiusercontent.com/x','https://files.oaiusercontent.com:8443/x','file:///etc/passwd'])assert.equal(isChatGptFileUrl(url),false)
  for(const url of ['https://files.oaiusercontent.com/x','https://sdmntprwestus.oaiusercontent.com/x','https://oaisdmntprwestus.blob.core.windows.net/x'])assert.equal(isChatGptFileUrl(url),true)
  let called=false
  await assert.rejects(()=>readChatGptFile({file_id:'file',download_url:'https://127.0.0.1/x'},()=>{called=true}),/unsupported_file_source/)
  assert.equal(called,false)
  const bytes=new Uint8Array(20);bytes.set([137,80,78,71,13,10,26,10])
  const result=await readChatGptFile({file_id:'file',download_url:'https://files.oaiusercontent.com/x'},async(url,options)=>{
    assert.equal(options.redirect,'error');return new Response(bytes,{headers:{'Content-Type':'image/png'}})
  })
  assert.deepEqual(result,bytes)
})
test('HTML SVG arbitrary bytes and oversized images are rejected',async()=>{
  assert.equal(imageMime(new TextEncoder().encode('<svg><script>alert(1)</script></svg>')),null)
  assert.equal(imageMime(new Uint8Array(MAX_IMAGE_BYTES+1)),null)
  await assert.rejects(()=>readChatGptFile({file_id:'file',download_url:'https://files.oaiusercontent.com/x'},async()=>new Response('html')),/invalid_illustration/)
  await assert.rejects(()=>readChatGptFile({file_id:'file',download_url:'https://files.oaiusercontent.com/x'},async()=>new Response('small',{headers:{'Content-Length':String(MAX_IMAGE_BYTES+1)}})),/file_too_large/)
})
