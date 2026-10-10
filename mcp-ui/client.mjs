import { READ_OPERATIONS, WRITE_OPERATIONS } from '../supabase/functions/comicchat-mcp/operations.mjs'

function unpack(result) {
  if (result.isError) throw new Error(result.content?.find(x => x.type === 'text')?.text || 'ComicChat request failed')
  if (result.structuredContent) return result.structuredContent
  const text = result.content?.find(x => x.type === 'text')?.text
  if (!text) throw new Error('ComicChat returned no result')
  return JSON.parse(text)
}
// The host supplies the selected OAuth connection. No bearer token enters the widget.
export function createMcpClient(callServerTool, profile, onProfile, initialConversationId = null) {
  const reads = new Set(READ_OPERATIONS), writes = new Set(WRITE_OPERATIONS)
  const invoke = async (name, args) => {
    try { return { data: unpack(await callServerTool({ name, arguments: { ...args, accountId: profile.id } })).data, error: null } }
    catch (e) { return { data: null, error: { message: e.message } } }
  }
  return {
    transport: 'mcp', initialConversationId,
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
    functions: { async invoke() { return { data: null, error: { message: 'Generated artwork is unavailable in this view.' } } } },
    storage: { from() { return { async download() { return { data: null, error: { message: 'Private artwork is unavailable in this view.' } } } } } },
  }
}
