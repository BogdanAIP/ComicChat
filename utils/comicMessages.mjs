// Shared message identity and ordering for direct and group conversations.
export function makeUuid() {
  const browserCrypto = globalThis.crypto
  if (browserCrypto?.randomUUID) return browserCrypto.randomUUID()
  if (!browserCrypto?.getRandomValues) throw new Error('Secure UUID generation is unavailable')
  const bytes = new Uint8Array(16)
  browserCrypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function sortMessages(messages) {
  return [...messages].sort((a, b) => {
    const time = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    return time || String(a.id).localeCompare(String(b.id))
  })
}

export function mergeMessage(previous, nextMessage) {
  const existing = previous.find((message) => message.id === nextMessage.id)
  // Initial/reconnect reads can finish after a more recent targeted event.
  if (existing?.updated_at && nextMessage.updated_at &&
      new Date(existing.updated_at).getTime() > new Date(nextMessage.updated_at).getTime()) {
    return previous
  }
  const withoutDuplicate = previous.filter((message) => {
    if (message.id === nextMessage.id) return false
    return !(nextMessage.client_nonce &&
      message.client_nonce === nextMessage.client_nonce &&
      message.sender_id === nextMessage.sender_id)
  })
  // A send response can omit frozen style; preserve it after a targeted read.
  const merged = { ...existing, ...nextMessage }
  if (existing && nextMessage.style === undefined) merged.style = existing.style
  return sortMessages([...withoutDuplicate, merged])
}

export function reusableSendAttempt(previous, conversationId, originalText) {
  if (previous?.conversationId === conversationId && previous.originalText === originalText) {
    return previous
  }
  return { conversationId, originalText, nonce: makeUuid() }
}
