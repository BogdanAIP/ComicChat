export const createClientNonce = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }

  throw new Error('Secure random client nonce is unavailable')
}

export const normalizeComicMessage = (row) => {
  if (!row) return null

  return {
    ...row,
    content: row.original_text ?? '',
    thread_id: row.conversation_id,
    file_url: null,
    file_type: null,
    file_name: null,
  }
}

export const normalizeComicConversation = (row, myUserId) => {
  if (!row) return null

  return {
    id: row.conversation_id,
    user_a: myUserId,
    user_b: row.other_user_id,
    otherUserId: row.other_user_id,
    otherUsername: row.other_username ?? null,
    created_at: row.conversation_created_at,
    lastMessage: row.last_message_content,
    lastMessageTime: row.last_message_time ?? row.conversation_created_at,
  }
}

export const ensureComicConversation = async (supabase, myUserId, partnerId) => {
  const { data, error } = await supabase.rpc('comic_ensure_conversation', {
    partner_id: partnerId,
  })

  if (error) throw error

  return {
    id: data,
    user_a: myUserId,
    user_b: partnerId,
    otherUserId: partnerId,
  }
}

export const listComicConversations = async (supabase, myUserId) => {
  const { data, error } = await supabase.rpc('comic_list_conversations')
  if (error) throw error
  return (data ?? []).map(row => normalizeComicConversation(row, myUserId))
}

export const listComicMessages = async (supabase, conversationId) => {
  const { data, error } = await supabase
    .from('comic_message')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw error
  return (data ?? []).map(normalizeComicMessage)
}

export const sendComicMessage = async (
  supabase,
  conversationId,
  originalText,
  clientNonce = createClientNonce(),
) => {
  const { data, error } = await supabase.rpc('comic_send_message', {
    p_conversation_id: conversationId,
    p_client_nonce: clientNonce,
    p_original_text: originalText,
  })

  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  return normalizeComicMessage(row)
}

const acknowledge = async (supabase, procedure, messageIds) => {
  if (!messageIds?.length) return []

  const { data, error } = await supabase.rpc(procedure, {
    p_message_ids: messageIds,
  })

  if (error) throw error
  return (data ?? []).map(normalizeComicMessage)
}

export const markComicMessagesDelivered = (supabase, messageIds) =>
  acknowledge(supabase, 'comic_mark_messages_delivered', messageIds)

export const markComicMessagesRead = (supabase, messageIds) =>
  acknowledge(supabase, 'comic_mark_messages_read', messageIds)

export const COMIC_PRIVATE_MEDIA_DISABLED_MESSAGE =
  'Private attachments are temporarily disabled while ComicChat moves media to participant-authorized private storage.'

export const searchComicUsers = async (supabase, query = '') => {
  const { data, error } = await supabase.rpc('comic_search_users', {
    p_query: query,
  })

  if (error) throw error

  return (data ?? []).map(row => ({
    id: row.user_id,
    username: row.username ?? null,
  }))
}
