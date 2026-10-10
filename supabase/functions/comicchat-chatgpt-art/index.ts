import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.109.0'
import { attachChatGptArt } from '../_shared/chatgpt-art.ts'
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type'}
Deno.serve(async req => {
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
  if(req.method!=='POST')return json({error:'method_not_allowed'},405)
  const authorization=req.headers.get('Authorization')
  if(!authorization?.startsWith('Bearer '))return json({error:'not_authenticated'},401)
  try {
    const body=await req.json()
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.messageId) ||
      typeof body.imageBase64!=='string' || body.imageBase64.length>11200000) return json({error:'invalid_request'},400)
    const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,
      {global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
    const bytes=Uint8Array.from(atob(body.imageBase64),c=>c.charCodeAt(0))
    return json(await attachChatGptArt(client,body.messageId,bytes))
  } catch {return json({error:'illustration_unavailable'},400)}
})
