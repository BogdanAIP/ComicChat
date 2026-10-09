import { createClient } from '@supabase/supabase-js'
import { AI_OAUTH_PROVIDERS, getAiOAuthConfig, newOAuthFlow } from '../../../utils/aiOAuthConnection.mjs'
export const config = { api: { bodyParser: true } }
function backend() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL
  const pub=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !pub || !secret) return null
  return {url,pub,service:createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})}
}
function err(res,status,reason) {return res.status(status).json({error:reason})}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store')
  if (!['GET','POST','DELETE'].includes(req.method)) return err(res,405,'method_not_allowed')
  const b=backend()
  if (!b) return err(res,503,'connector_backend_not_configured')
  const bearer=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]
  if (!bearer) return err(res,401,'not_authenticated')
  const caller=createClient(b.url,b.pub,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:{user}={},error:authError}=await caller.auth.getUser(bearer)
  if (authError || !user) return err(res,401,'not_authenticated')
  if (req.method==='GET') {
    const {data,error}=await b.service.from('comic_ai_account_link')
      .select('provider,created_at').eq('user_id',user.id)
    if(error) return err(res,503,'connection_storage_unavailable')
    return res.status(200).json({connectors:AI_OAUTH_PROVIDERS.map(provider=>({
      id:provider, configured:Boolean(getAiOAuthConfig(provider)),
      connected:Boolean(data?.some(row=>row.provider===provider)),
      linkedAt:data?.find(row=>row.provider===provider)?.created_at||null,
      capabilities:['account.identity'],imageGenerationAuthorized:false
    }))})
  }
  const provider=req.body?.provider
  if(!AI_OAUTH_PROVIDERS.includes(provider)) return err(res,400,'unknown_provider')
  if(req.method==='DELETE') {
    const {error}=await b.service.from('comic_ai_account_link').delete()
      .eq('user_id',user.id).eq('provider',provider)
    if(error) return err(res,503,'unlink_failed')
    return res.status(200).json({provider,connected:false})
  }
  const providerConfig=getAiOAuthConfig(provider)
  if (!providerConfig) return err(res,409,'provider_not_configured')
  const attempt=newOAuthFlow(providerConfig)
  const {error}=await b.service.from('comic_ai_oauth_flow').insert({
    state_hash:attempt.stateHash,user_id:user.id,provider,
    code_verifier:attempt.codeVerifier,
    expires_at:new Date(Date.now()+10*60*1000).toISOString()
  })
  if(error) return err(res,503,'connection_start_unavailable')
  return res.status(200).json({provider,authorizationUrl:attempt.authorizationUrl,expiresIn:600})
}
