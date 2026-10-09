// ComicChat connector registry: identity/transport != model capability != billing.
// Keep this pure and usable from Next.js, Deno, tests and MCP App.
const items = [
  ['comicchat-template','native-code','ComicChat code-rendered panels',['panel.render'],'none','free',true],
  ['openai-image','cloud-api','OpenAI Images API',['image.generate','image.edit'],'server-api-key','app-api',true],
  ['chatgpt-app-host','mcp-host','ChatGPT embedded ComicChat',['chat.read','chat.write','app.display'],'comicchat-oauth','none',true],
  ['chatgpt-account','oauth-account','Connect ChatGPT account',['account.identity'],'oidc-pkce','not-authorized',false],
  ['codex-account','oauth-account','Connect Codex account',['account.identity'],'oidc-pkce','not-authorized',false],
  ['comfyui-local','local-worker','Local ComfyUI',['image.generate','image.edit'],'local-agent','own-compute',false],
  ['mcp-image','mcp-tool','Authorized external MCP image tool',['image.generate','image.import'],'mcp-oauth','provider-defined',false]
]
const catalog = Object.freeze(items.map(([id,kind,label,capabilities,connection,billing,implemented]) =>
  Object.freeze({id,kind,label,capabilities:Object.freeze(capabilities),connection,billing,implemented})))
export function listAiConnectors() {
  return catalog.map(x => ({...x,capabilities:[...x.capabilities]}))
}
export function getAiConnector(id) {
  return listAiConnectors().find(x => x.id === id) || null
}
// Only real, sender-scoped grants are actionable. Do not treat ChatGPT/Codex
// identity, model availability or iframe hosting as permission to generate art.
export function assessAiCapability({connectorId,capability,configured=false,userId=null,grants=[],billingApproved=false}) {
  const item=getAiConnector(connectorId)
  if (!item || !item.capabilities.includes(capability))
    return {allowed:false,reason:'unsupported_capability'}
  if (!item.implemented) return {allowed:false,reason:'adapter_not_implemented'}
  if (item.connection!=='none' && !configured)
    return {allowed:false,reason:'connection_not_configured'}
  if (item.billing!=='free' && item.billing!=='none' && !billingApproved)
    return {allowed:false,reason:'billing_not_approved'}
  if (item.connection!=='none' && (!userId || !grants.includes(capability)))
    return {allowed:false,reason:'capability_not_granted'}
  return {allowed:true,reason:'ok'}
}
// Fail closed: never silently switch billing accounts or providers.
export function selectAiConnector({preferredId,capability,connections=[]}) {
  const connection=connections.find(x=>x.connectorId===preferredId)
  const result=assessAiCapability({connectorId:preferredId,capability,
    configured:connection?.configured===true,userId:connection?.userId,
    grants:connection?.grants||[],billingApproved:connection?.billingApproved===true})
  return {...result,connector:result.allowed?getAiConnector(preferredId):null}
}
