import assert from 'node:assert/strict'
import {getAiOAuthConfig,newOAuthFlow,hashOAuthState} from '../utils/aiOAuthConnection.mjs'
const env={
  COMICCHAT_PUBLIC_ORIGIN:'https://comicchat.example/',
  COMICCHAT_CHATGPT_OAUTH_CLIENT_ID:'approved-client-id',
  COMICCHAT_CHATGPT_OAUTH_AUTHORIZATION_URL:'https://id.example/authorize',
  COMICCHAT_CHATGPT_OAUTH_TOKEN_URL:'https://id.example/token',
  COMICCHAT_CHATGPT_OAUTH_USERINFO_URL:'https://id.example/userinfo'
}
assert.equal(getAiOAuthConfig('chatgpt-account',{}),null)
assert.equal(getAiOAuthConfig('codex-account',env),null)
assert.equal(getAiOAuthConfig('chatgpt-account',{...env,COMICCHAT_CHATGPT_OAUTH_TOKEN_URL:'http://insecure/token'}),null)
assert.equal(getAiOAuthConfig('__proto__',env),null)
const cfg=getAiOAuthConfig('chatgpt-account',env)
assert.equal(cfg.scope,'openid profile')
assert.equal(cfg.redirectUri,'https://comicchat.example/api/ai/callback')
const a=newOAuthFlow(cfg),b=newOAuthFlow(cfg)
assert.notEqual(a.state,b.state)
assert.equal(hashOAuthState(a.state),a.stateHash)
assert.equal(hashOAuthState(b.state),b.stateHash)
assert.equal(hashOAuthState('not valid!'),null)
const url=new URL(a.authorizationUrl)
assert.equal(url.searchParams.get('response_type'),'code')
assert.equal(url.searchParams.get('code_challenge_method'),'S256')
assert.equal(url.searchParams.get('code_challenge').length,43)
assert.equal(url.searchParams.get('scope'),'openid profile')
assert.equal(url.searchParams.get('redirect_uri'),cfg.redirectUri)
assert.ok(!a.authorizationUrl.includes('token'))
console.log('OAuth connection flow: PASS (PKCE/S256, unique states, explicit HTTPS config, identity-only scopes)')
