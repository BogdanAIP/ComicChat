import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeMessage, sortMessages } from './comicMessages.mjs'

const PAGE_SIZE = 50

export default function useComicMessages({ supabase, session, conversationId, onActivity, onStyleChange }) {
  const [state, setState] = useState({ conversationId: null, messages: [], hasOlder: false })
  const [connectionState, setConnectionState] = useState('idle')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState('')
  const scopeRef = useRef(null)
  const stateRef = useRef(state)
  const activityRef = useRef(onActivity)
  const styleRef = useRef(onStyleChange)
  useEffect(() => {
    stateRef.current = state
    activityRef.current = onActivity
    styleRef.current = onStyleChange
  }, [state, onActivity, onStyleChange])

  const setMessages = useCallback((update) => {
    setState((current) => {
      if (current.conversationId !== conversationId) return current
      const messages = typeof update === 'function' ? update(current.messages) : update
      return { ...current, messages }
    })
  }, [conversationId])

  useEffect(() => {
    const scope = { conversationId, active: true, channel: null, request: 0 }
    scopeRef.current = scope
    if (!conversationId) return () => { scope.active = false }

    const applyRows = (rows, isPage = false) => {
      if (!scope.active) return
      setState((current) => {
        if (current.conversationId !== conversationId) return current
        let messages = current.messages
        for (const row of rows) messages = mergeMessage(messages, row)
        return { ...current, messages, ...(isPage ? { hasOlder: rows.length === PAGE_SIZE } : {}) }
      })
    }

    const refreshLatest = async () => {
      const request = ++scope.request
      const { data, error: rpcError } = await supabase.rpc('comic_read_message_page', {
        p_conversation_id: conversationId, p_limit: PAGE_SIZE,
      })
      if (!scope.active || request !== scope.request) return
      if (rpcError) { setError('historyLoadFailed'); return }
      applyRows(data || [], true)
      setError('')
      activityRef.current?.(conversationId)
      styleRef.current?.()
    }

    const receive = async (event) => {
      const payload = event?.payload || event || {}
      if (payload.conversation_id && payload.conversation_id !== conversationId) return
      if (!payload.message_id) { await refreshLatest(); return }
      const { data, error: rpcError } = await supabase.rpc('comic_read_message', {
        p_message_id: payload.message_id,
      })
      if (!scope.active) return
      if (rpcError) { setError('historyLoadFailed'); return }
      const row = Array.isArray(data) ? data[0] : data
      if (row?.conversation_id === conversationId) {
        applyRows([row])
        activityRef.current?.(conversationId)
      }
    }

    const subscribe = async () => {
      try {
        await supabase.realtime.setAuth(session.access_token)
        if (!scope.active) return
        setState((current) => current.conversationId === conversationId
          ? current : { conversationId, messages: [], hasOlder: false })
        setError('')
        setLoadingOlder(false)
        setConnectionState('connecting')
        scope.channel = supabase.channel(`conversation:${conversationId}`, {
          config: { private: true },
        })
          .on('broadcast', { event: 'INSERT' }, receive)
          .on('broadcast', { event: 'UPDATE' }, receive)
          .on('broadcast', { event: 'STYLE_UPDATE' }, () => {
            if (scope.active) styleRef.current?.()
          })
          .subscribe((status) => {
            if (!scope.active) return
            setConnectionState(status === 'SUBSCRIBED' ? 'connected' : status.toLowerCase())
            if (status === 'SUBSCRIBED') refreshLatest()
          })
        // Initial history is useful even when realtime is temporarily offline.
        await refreshLatest()
      } catch (loadError) {
        if (scope.active) {
          setState({ conversationId, messages: [], hasOlder: false })
          setError('historyLoadFailed')
          setConnectionState('offline')
        }
      }
    }
    subscribe()
    return () => {
      scope.active = false
      if (scope.channel) supabase.removeChannel(scope.channel)
    }
  }, [conversationId, session.access_token, supabase])

  const loadOlder = useCallback(async () => {
    const scope = scopeRef.current
    const current = stateRef.current
    if (!scope?.active || scope.conversationId !== conversationId || loadingOlder || !current.hasOlder) return false
    const oldest = current.messages.find((message) => !String(message.id).startsWith('temp-'))
    if (!oldest) return false
    setLoadingOlder(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('comic_read_message_page', {
        p_conversation_id: conversationId, p_limit: PAGE_SIZE,
        p_before_created_at: oldest.created_at, p_before_id: oldest.id,
      })
      if (!scope.active) return false
      if (rpcError) throw rpcError
      setState((previous) => {
        if (previous.conversationId !== conversationId) return previous
        let messages = previous.messages
        for (const row of data || []) messages = mergeMessage(messages, row)
        return { ...previous, messages: sortMessages(messages), hasOlder: (data || []).length === PAGE_SIZE }
      })
      setError('')
      return true
    } catch (loadError) {
      if (scope.active) setError('historyLoadFailed')
      return false
    } finally {
      if (scope.active) setLoadingOlder(false)
    }
  }, [conversationId, loadingOlder, supabase])

  return {
    messages: state.conversationId === conversationId ? state.messages : [],
    hasOlder: state.conversationId === conversationId && state.hasOlder,
    setMessages, connectionState: !conversationId ? 'idle'
      : state.conversationId !== conversationId ? 'connecting' : connectionState,
    error: state.conversationId === conversationId ? error : '', loadOlder, loadingOlder,
  }
}
