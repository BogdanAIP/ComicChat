import { READ_OPERATIONS, WRITE_OPERATIONS } from '../supabase/functions/comicchat-mcp/operations.mjs'

function unpack(result) {
  if (result.isError) throw new Error(result.content?.find(x => x.type === 'text')?.text || 'ComicChat request failed')
  if (result.structuredContent) return result.structuredContent
  const text = result.content?.find(x => x.type === 'text')?.text
  if (!text) throw new Error('ComicChat returned no result')
  return JSON.parse(text)
}
// The host supplies the selected OAuth connection. No bearer token enters the widget.
export function createMcpClient(callServerTool, profile, onProfile, initialConversationId = null, host = {}) {
  const reads = new Set(READ_OPERATIONS), writes = new Set(WRITE_OPERATIONS)
  const invoke = async (name, args) => {
    try { return { data: unpack(await callServerTool({ name, arguments: { ...args, accountId: profile.id } })).data, error: null } }
    catch (e) { return { data: null, error: { message: e.message } } }
  }
  return {
    transport: 'mcp', initialConversationId, requestArt: host.requestArt,
    rpc(operation, args = {}) {
      const name = reads.has(operation) ? 'comicchat_ui_read' :
        writes.has(operation) ? 'comicchat_ui_write' : null
      if (!name) return Promise.resolve({ data: null, error: { message: 'Unsupported ComicChat operation' } })
      return invoke(name, { request: { operation, args } })
    },
    auth: {
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } },
      async signOut() { return { error: { message: 'Manage this account connection in ChatGPT plugin settings.' } } },
    },
    from(table) {
      return { update(values) { return { async eq(column, id) {
        if (table !== 'user' || column !== 'id' || id !== profile.id ||
            Object.keys(values).length !== 1 || typeof values.username !== 'string') {
          return { error: { message: 'Only your own username can be updated here.' } }
        }
        const result = await invoke('comicchat_ui_update_profile', { username: values.username })
        if (!result.error) onProfile?.(result.data)
        return result
      } } } }
    },
    functions: { async invoke(name, {body} = {}) {
      if(name!=='comicchat-chatgpt-art') return {data:null,error:{message:'Unsupported ComicChat function'}}
      return invoke('comicchat_ui_attach_art',body)
    } },
    storage: { from(bucket) { return { async download(path) {
      if(bucket!=='comicchat-art' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}(\/[0-9a-f-]{36})?\.webp$/i.test(path))return {data:null,error:{message:'Invalid artwork path'}}
      try {
        const segments=path.split('/')
        const messageId=segments[1].replace('.webp','')
        const assetId=(segments[2]||segments[1]).replace('.webp','')
        const result=await callServerTool({name:'comicchat_ui_read_art',arguments:{accountId:profile.id,messageId,assetId}})
        if(result.isError)throw new Error('Artwork unavailable')
        const meta=result._meta
        if(!meta?.imageBase64)throw new Error('Artwork unavailable')
        return {data:new Blob([Uint8Array.from(atob(meta.imageBase64),c=>c.charCodeAt(0))],{type:meta.mimeType}),error:null}
      } catch(e){return {data:null,error:{message:e.message}}}
    } } } },
  }
}
