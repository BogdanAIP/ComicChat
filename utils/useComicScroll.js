import { useLayoutEffect, useRef } from 'react'

// Keep incoming panels visible only when the reader is already near the end.
// Prepending history preserves the reader's viewport instead of jumping down.
export default function useComicScroll(ref, conversationId, messages) {
  const nearBottom = useRef(true)
  const previous = useRef({ conversationId: null, height: 0, firstId: null, count: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const old = previous.current
    const changedConversation = old.conversationId !== conversationId
    const prepended = !changedConversation && old.firstId && messages[0]?.id !== old.firstId && messages.length > old.count
    if (changedConversation || (!prepended && nearBottom.current)) {
      element.scrollTop = element.scrollHeight
      nearBottom.current = true
    } else if (prepended) {
      element.scrollTop += Math.max(0, element.scrollHeight - old.height)
    }
    previous.current = {
      conversationId, height: element.scrollHeight,
      firstId: messages[0]?.id, count: messages.length,
    }
  }, [conversationId, messages, ref])

  const onScroll = () => {
    const element = ref.current
    if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96
  }
  const followEnd = () => { nearBottom.current = true }
  return { onScroll, followEnd }
}
