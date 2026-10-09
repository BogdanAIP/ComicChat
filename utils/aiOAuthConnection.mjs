import { createHash, randomBytes } from 'node:crypto'
const PREFIX = Object.freeze({ 'chatgpt-account': 'COMICCHAT_CHATGPT', 'codex-account': 'COMICCHAT_CODEX' })
export const AI_OAUTH_PROVIDERS = Object.freeze(Object.keys(PREFIX))
function exactHttps(value) {
  if (!value) return null
  try { const u=new URL(value); if (u.protocol !== 'https:' || u.username || u.password || u.hash) return null; return u.toString() }
  catch { return null }
}
export function getAiOAuthConfig(provider, env=process.env) {
  const prefix=Object.hasOwn(PREFIX,provider) ? PREFIX[provider] : null
  if (!prefix) return null
  const origin=exactHttps(env.COMICCHAT_PUBLIC_ORIGIN)
  const authUrl=exactHttps(env[prefix+'_OAUTH_AUTHORIZATION_URL'])
  const tokenUrl=exactHttps(env[prefix+'_OAUTH_TOKEN_URL'])
  const userinfoUrl=exactHttps(env[prefix+'_OAUTH_USERINFO_URL'])
  const clientId=env[prefix+'_OAUTH_CLIENT_ID']
  if (!origin || !authUrl || !tokenUrl || !userinfoUrl || !clientId) return null
  const site=new URL(origin)
  if (site.pathname!=='/' || site.search) return null
  return { provider,authorizationUrl:authUrl,tokenUrl,userinfoUrl,clientId,
    clientSecret:env[prefix+'_OAUTH_CLIENT_SECRET'] || null, scope:'openid profile',
    redirectUri:new URL('/api/ai/callback',origin).toString(), returnOrigin:site.origin }
}
export function newOAuthFlow(config) {
  if (!config) throw new Error('oauth_provider_not_configured')
  const state=randomBytes(32).toString('base64url')
  const verifier=randomBytes(48).toString('base64url')
  const challenge=createHash('sha256').update(verifier).digest('base64url')
  const target=new URL(config.authorizationUrl)
  for(const [key,value] of Object.entries({
    response_type:'code',client_id:config.clientId,redirect_uri:config.redirectUri,
    scope:config.scope,state,code_challenge:challenge,code_challenge_method:'S256'
  })) target.searchParams.set(key,value)
  return { stateHash:createHash('sha256').update(state).digest('hex'),
    state,codeVerifier:verifier,authorizationUrl:target.toString() }
}
export function hashOAuthState(state) {
  if (typeof state!=='string'||!/^[-_A-Za-z0-9]{30,128}$/.test(state)) return null
  return createHash('sha256').update(state).digest('hex')
}
