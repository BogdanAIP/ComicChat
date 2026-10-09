import { createClient } from '@supabase/supabase-js'
import { getAiOAuthConfig, hashOAuthState } from '../../../utils/aiOAuthConnection.mjs'
function redirect(res,origin,result) {
  const safe=origin && /^https:\/\/[^/]+$/.test(origin) ? origin : null
  if (!safe) return res.status(400).json({error:result})
  return res.redirect(303,safe+'/ai-connections?result='+encodeURIComponent(result))
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store')
  if (req.method!=='GET') return res.status(405).json({error:'method_not_allowed'})
  const origin=(()=>{try{
    const u=new URL(process.env.COMICCHAT_PUBLIC_ORIGIN)
    return u.protocol==='https:' && u.pathname==='/' ? u.origin : null
  }catch{return null}})()
  const stateHash=hashOAuthState(req.query.state)
  const code=req.query.code
  if(!origin || !stateHash || typeof code!=='string' || code.length>4096)
    return redirect(res,origin,'invalid_callback')
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!key) return redirect(res,origin,'connection_unavailable')
  const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  // Atomic, single-use consume: two callbacks cannot redeem the same state.
  const {data:flow,error:flowError}=await service.from('comic_ai_oauth_flow')
    .delete().eq('state_hash',stateHash).gt('expires_at',new Date().toISOString())
    .select('user_id,provider,code_verifier').maybeSingle()
  if(flowError||!flow) return redirect(res,origin,'expired_or_used')
  const cfg=getAiOAuthConfig(flow.provider)
  if(!cfg || cfg.returnOrigin!==origin) return redirect(res,origin,'provider_not_configured')
  try {
    const params=new URLSearchParams({grant_type:'authorization_code',code,
      redirect_uri:cfg.redirectUri,client_id:cfg.clientId,code_verifier:flow.code_verifier})
    const headers={'Content-Type':'application/x-www-form-urlencoded'}
    if(cfg.clientSecret) {
      headers.Authorization='Basic '+Buffer.from(cfg.clientId+':'+cfg.clientSecret).toString('base64')
      params.delete('client_id')
    }
    const tokenResponse=await fetch(cfg.tokenUrl,{method:'POST',headers,body:params,
      signal:AbortSignal.timeout(12000)})
    if(!tokenResponse.ok) return redirect(res,origin,'authorization_rejected')
    const token=await tokenResponse.json()
    if(typeof token.access_token!=='string'||!token.access_token)
      return redirect(res,origin,'authorization_rejected')
    const identityResponse=await fetch(cfg.userinfoUrl,{
      headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(12000)})
    if(!identityResponse.ok) return redirect(res,origin,'identity_unavailable')
    const identity=await identityResponse.json()
    if(typeof identity.sub!=='string'||!identity.sub||identity.sub.length>512)
      return redirect(res,origin,'identity_invalid')
    // Never silently reassign an existing linked identity to a different account.
    const {data:existing,error:lookupError}=await service.from('comic_ai_account_link')
      .select('provider_subject').eq('user_id',flow.user_id).eq('provider',flow.provider).maybeSingle()
    if(lookupError) return redirect(res,origin,'connection_storage_unavailable')
    if(existing && existing.provider_subject!==identity.sub)
      return redirect(res,origin,'unlink_first')
    if(!existing) {
      const {error:insertError}=await service.from('comic_ai_account_link')
        .insert({user_id:flow.user_id,provider:flow.provider,provider_subject:identity.sub})
      if(insertError) return redirect(res,origin,'identity_already_linked_or_storage_failure')
    }
    // Access/refresh tokens and id_tokens are intentionally NOT stored: this
    // is an identity-only link, not a claim to ChatGPT plan or image scopes.
    return redirect(res,origin,'connected')
  } catch {
    return redirect(res,origin,'authorization_unavailable')
  }
}
