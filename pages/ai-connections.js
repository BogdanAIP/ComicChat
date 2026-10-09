import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
export default function AiConnections({ session }) {
  const router=useRouter()
  const [connectors,setConnectors]=useState([])
  const [busy,setBusy]=useState('')
  const [notice,setNotice]=useState('')
  const token=session?.access_token
  useEffect(() => {
    if(!token) return undefined
    let active=true
    fetch('/api/ai/connections',{headers:{Authorization:'Bearer '+token}})
      .then(async r => {if(!r.ok) throw Error('Connection status unavailable');return r.json()})
      .then(data => {if(active) setConnectors(data.connectors||[])})
      .catch(() => {if(active) setNotice('Connection status unavailable.')})
    return () => {active=false}
  },[token])
  async function change(provider,method) {
    if(!token || busy) return
    setBusy(provider);setNotice('')
    try {
      const response=await fetch('/api/ai/connections',{
        method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({provider})})
      const data=await response.json()
      if(!response.ok) throw Error(data.error||'Connection error')
      if(method==='POST') {
        // Auth redirect is returned only after a verified ComicChat session
        // and a configured HTTPS identity provider have created a one-use PKCE flow.
        window.location.assign(data.authorizationUrl)
        return
      }
      setConnectors(items=>items.map(item=>item.id===provider?{...item,connected:false,linkedAt:null}:item))
      setNotice('Account link disconnected. Other service permissions were not changed.')
    } catch(error) {setNotice(error.message||'Connection failed')}
    finally {setBusy('')}
  }
  return <main style={{maxWidth:720,margin:'30px auto',padding:20}}>
    <nav><Link href="/">← ComicChat</Link></nav>
    <h1>AI connections</h1>
    <p>Connect accounts first. Image tools, personal plan usage and billing require separate verified permissions.</p>
    {router.query.result && <p role="status">Connection result: {String(router.query.result).replaceAll('_',' ')}</p>}
    {!token && <p>Sign in to ComicChat to manage your connections.</p>}
    {token && connectors.length===0 && <p>No configured account providers are available yet.</p>}
    {connectors.map(c=><section key={c.id} style={{border:'1px solid #777',borderRadius:12,padding:16,marginBlock:12}}>
      <h2 style={{margin:0,fontSize:'1.1rem'}}>{c.id==='chatgpt-account'?'ChatGPT account':'Codex account'}</h2>
      <p>{c.connected?'Identity linked':'Not connected'} · {c.configured?'OAuth configured':'OAuth client not configured'}</p>
      <small>Only account identity is linked. Generation from ChatGPT subscription: not authorized.</small>
      <div style={{marginTop:12}}>
        <button type="button" disabled={!!busy||!c.configured||c.connected}
          onClick={()=>change(c.id,'POST')}>Connect</button>{' '}
        <button type="button" disabled={!!busy||!c.connected}
          onClick={()=>change(c.id,'DELETE')}>Disconnect</button>
      </div>
    </section>)}
    {notice && <p role="status">{notice}</p>}
  </main>
}
