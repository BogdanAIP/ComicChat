import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeStyleConfig } from '../utils/comicStyleSkills.mjs'

const DEFAULT_STYLE = normalizeStyleConfig()

export default function useComicChatStyles(supabase, conversationId, messages = []) {
  const [saved, setSaved] = useState({ conversationId: null, current: DEFAULT_STYLE })
  const [pendingConversation, setPendingConversation] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const scopeRef = useRef(null)
  const snapshots = useMemo(() => Object.fromEntries(messages
    .filter((message) => message.id && Object.hasOwn(message, 'style'))
    .map((message) => [message.id, message.style?.primary_style_id === 'classic' || !message.style
      ? null : normalizeStyleConfig(message.style)])), [messages])

  const refresh = useCallback(async () => {
    const scope = scopeRef.current
    if (!conversationId || !scope?.active || scope.conversationId !== conversationId) return
    const { data, error: rpcError } = await supabase.rpc(
      'comic_get_conversation_style', { p_conversation_id: conversationId }
    )
    if (!scope.active) return
    if (rpcError) {
      setSaved({ conversationId, current: DEFAULT_STYLE })
      setError('styleLoadFailed')
    }
    else {
      setSaved({ conversationId, current: normalizeStyleConfig(data?.[0]) })
      setError('')
    }
    setNotice('')
  }, [conversationId, supabase])

  useEffect(() => {
    const scope = { conversationId, active: true }
    scopeRef.current = scope
    const timer = setTimeout(refresh, 0)
    return () => { scope.active = false; clearTimeout(timer) }
  }, [conversationId, refresh])

  const save = useCallback(async (input) => {
    if (!conversationId) return false
    const scope = scopeRef.current
    const desired = normalizeStyleConfig(input)
    setPendingConversation(conversationId)
    setNotice('')
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc(
        'comic_set_conversation_style', {
          p_conversation_id: conversationId,
          p_primary_style_id: desired.primary_style_id,
          p_secondary_style_id: desired.secondary_style_id,
          p_secondary_weight: desired.secondary_weight,
        }
      )
      if (rpcError) throw rpcError
      if (!scope?.active) return false
      setSaved({ conversationId, current: desired })
      setNotice('styleSaved')
      return true
    } catch (e) {
      console.error('Style update failed', e)
      if (scope?.active) setError('styleSaveFailed')
      return false
    } finally {
      setPendingConversation((previous) => previous === conversationId ? null : previous)
    }
  }, [conversationId, supabase])

  return {
    current: saved.conversationId === conversationId ? saved.current : DEFAULT_STYLE,
    snapshots, save, refresh, pending: pendingConversation === conversationId && !!conversationId,
    notice: saved.conversationId === conversationId ? notice : '',
    error: saved.conversationId === conversationId ? error : '',
  }
}
