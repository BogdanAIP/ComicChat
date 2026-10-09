import { useCallback, useState } from 'react'

// Drafts stay with their conversation when the reader opens another chat.
export default function useConversationDraft(conversationId) {
  const [drafts, setDrafts] = useState({})
  const setDraft = useCallback((update) => {
    if (!conversationId) return
    setDrafts((previous) => {
      const current = previous[conversationId] || ''
      const next = typeof update === 'function' ? update(current) : update
      return { ...previous, [conversationId]: next }
    })
  }, [conversationId])
  return [conversationId ? drafts[conversationId] || '' : '', setDraft]
}
