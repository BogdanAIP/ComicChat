import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@modelcontextprotocol/ext-apps'
import Home from '../pages/index'
import { RouterProvider } from './next-router'
import { createMcpClient } from './client.mjs'
import '../styles/globals.css'

const bridge = new App({ name: 'ComicChat', version: '0.2.0' }, {}, { strict: true, autoResize: true })
const root = createRoot(document.getElementById('root'))
let connected = false, pending = null, activeId = null
function Workspace({ initialProfile, selectedConversationId }) {
  const [profile, setProfile] = useState(initialProfile)
  const [supabase] = useState(() => createMcpClient(
    request => bridge.callServerTool(request), initialProfile,
    row => setProfile(previous => ({ ...previous, username: row.username })), selectedConversationId
  ))
  const [session] = useState(() => ({ user: { id: initialProfile.id, email: initialProfile.email } }))
  return <RouterProvider><Home currentUser={{ ...profile, username: profile.username || profile.name }}
    session={session} supabase={supabase} /></RouterProvider>
}
function show(result) {
  const data = result.structuredContent || JSON.parse(result.content?.find(x => x.type === 'text')?.text || '{}')
  if (!data.profile?.id) return
  pending = data
  if (!connected || activeId === data.profile.id + ':' + (data.selectedConversationId || '')) return
  activeId = data.profile.id + ':' + (data.selectedConversationId || '')
  // Remount on account changes so drafts/history cannot cross OAuth identities.
  root.render(<Workspace key={activeId} initialProfile={data.profile} selectedConversationId={data.selectedConversationId} />)
}
bridge.ontoolresult = show
root.render(<p role="status">Connecting ComicChat…</p>)
bridge.connect().then(() => {
  connected = true
  if (pending) show({ structuredContent: pending })
}).catch(error => root.render(<p role="alert">{error.message}</p>))
