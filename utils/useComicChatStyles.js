import { useCallback, useEffect, useMemo, useState } from 'react'
import { normalizeStyleConfig } from '../utils/comicStyleSkills.mjs'

const DEFAULT_STYLE = normalizeStyleConfig()

export default function useComicChatStyles(supabase, conversationId, messages = []) {
  const [current, setCurrent] = useState(DEFAULT_STYLE)
  const [snapshots, setSnapshots] = useState({})
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const messageIds = useMemo(
    () => messages.filter((m) => m.id && !String(m.id).startsWith('temp-'))
      .map((m) => m.id).join(','),
    [messages]
  )

  useEffect(() => {
    if (!conversationId) return undefined
    let active = true
    const load = async () => {
      const { data, error: rpcError } = await supabase.rpc(
        'comic_get_conversation_style', { p_conversation_id: conversationId }
      )
      if (!active) return
      if (rpcError) setError('Unable to load style settings.')
      else {
        setCurrent(normalizeStyleConfig(data?.[0]))
        setError('')
      }
    }
    load()
    return () => { active = false }
  }, [conversationId, supabase])

  useEffect(() => {
    if (!conversationId) return undefined
    let active = true
    const load = async () => {
      const { data, error: rpcError } = await supabase.rpc(
        'comic_list_message_styles', { p_conversation_id: conversationId }
      )
      if (!active) return
      if (rpcError) {
        setError('Could not load message artwork styles.')
        return
      }
      const byMessage = Object.fromEntries((data || []).map((row) => [
        row.message_id,
        row.primary_style_id === 'classic' ? null : normalizeStyleConfig(row),
      ]))
      setSnapshots(byMessage)
    }
    load()
    return () => { active = false }
  }, [conversationId, messageIds, supabase])

  const save = useCallback(async (input) => {
    if (!conversationId) return false
    const desired = normalizeStyleConfig(input)
    setPending(true)
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
      setCurrent(desired)
      setNotice('Style saved. Future comic messages will use it; older panels stay unchanged.')
      return true
    } catch (e) {
      console.error('Style update failed', e)
      setError('Unable to save style. Check your permissions.')
      return false
    } finally {
      setPending(false)
    }
  }, [conversationId, supabase])

  return {
    current, snapshots, save, pending, notice, error,
  }
}
