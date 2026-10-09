import { createClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default function useSupabase() {
  const [currentUser, setCurrentUser] = useState(null)
  const [session, setSession] = useState(null)
  const identityRef = useRef(null)

  useEffect(() => {
    let active = true
    let authVersion = 0
    const acceptSession = (nextSession) => {
      const nextId = nextSession?.user?.id || null
      if (identityRef.current !== nextId) setCurrentUser(null)
      identityRef.current = nextId
      setSession(nextSession)
    }
    supabase.auth.getSession().then(({ data }) => {
      if (active && authVersion === 0) acceptSession(data.session)
    })
    // Keep the auth callback synchronous; async profile work belongs to its effect.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authVersion += 1
      if (active) acceptSession(nextSession)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  const userId = session?.user?.id
  const userEmail = session?.user?.email
  useEffect(() => {
    if (!userId) return undefined
    let active = true
    let channel = null
    const live = () => active && identityRef.current === userId
    const getCurrentUser = async () => {
      let { data: profile, error } = await supabase.from('user').select('*').eq('id', userId).single()
      if (!live()) return
      if (error?.code === 'PGRST116') {
        // Existing installations may predate the server-side profile trigger.
        const inserted = await supabase.from('user')
          .insert([{ id: userId, username: null, email: userEmail }]).select().single()
        if (!live()) return
        if (inserted.error?.code === '23505') {
          const existing = await supabase.from('user').select('*').eq('id', userId).single()
          if (!live()) return
          profile = existing.data
          error = existing.error
        } else {
          profile = inserted.data
          error = inserted.error
        }
      }
      if (error || !profile) {
        console.error('Unable to load ComicChat profile', error)
        if (live()) setCurrentUser(null)
        return
      }
      if (userEmail && profile.email !== userEmail) {
        const { data } = await supabase.from('user').update({ email: userEmail }).eq('id', userId).select().single()
        if (!live()) return
        if (data) profile = data
      }
      if (!live()) return
      setCurrentUser(profile)
      channel = supabase.channel(`profile:${userId}`)
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'user', filter: `id=eq.${userId}`,
        }, (payload) => {
          if (live() && payload.new.id === userId) setCurrentUser(payload.new)
        }).subscribe()
    }
    getCurrentUser().catch((error) => {
      if (live()) console.error('Unable to load ComicChat profile', error)
    })
    return () => { active = false; if (channel) supabase.removeChannel(channel) }
  }, [userId, userEmail])

  return { currentUser, session, supabase }
}
