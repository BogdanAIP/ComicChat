import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {chromium} from '@playwright/test'
const evidence=process.env.COMICCHAT_THEME_EVIDENCE || path.resolve('test-results/comic-themes')
await fs.mkdir(evidence,{recursive:true})
const src=await fs.readFile('supabase/functions/comicchat-mcp/ui.ts','utf8')
const html=JSON.parse(src.slice(src.indexOf(' = ')+3))
const fixture=await fs.readFile('mcp-ui/qa-host-script.js','utf8')
const host=evidence+'/host.html'
await fs.writeFile(host,'<!doctype html><html><body style="margin:0"><script>'+fixture+'</script><iframe style="width:100vw;height:100vh;border:0" srcdoc="'+html.replaceAll('&','&amp;').replaceAll('"','&quot;')+'"></iframe></body></html>')
const browser=await chromium.launch({channel:process.env.MCP_UI_BROWSER_CHANNEL || (process.platform==='win32'?'chrome':undefined),headless:true})
const page=await browser.newPage({viewport:{width:1280,height:850}})
page.setDefaultTimeout(10000)
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const result={at:new Date().toISOString(),themes:[],checks:[]}
try{
await page.goto(pathToFileURL(host).href)
const f=page.frameLocator('iframe')
await f.getByTestId('comic-conversation').first().click()
const exact='Привет! Давай встретимся завтра у кофейни.\nОригинальный текст остаётся читаемым ☕'
await f.getByTestId('comic-composer').fill(exact)
await f.getByTestId('comic-send').click()
await page.evaluate(()=>window.qaMessages.push({id:'00000000-0000-4000-a000-000000000038',conversation_id:window.qaDM.conversation_id,sender_id:window.qaDM.other_user_id,original_text:'Договорились! До встречи ☕',status:'queued',created_at:new Date().toISOString(),style:{primary_style_id:'manga',style_version:1}}))
const incoming=f.locator('article[data-message-id="00000000-0000-4000-a000-000000000038"]')
const card=f.locator('article[data-message-id="00000000-0000-4000-a000-000000000037"]')
await card.waitFor()
const contrast=(a,b)=>{const lum=s=>{const c=s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722};const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
for(const theme of ['manga','superhero','cartoon']){
 await f.getByTestId('settings-nav').click()
 await f.getByTestId('ui-language').selectOption('ru')
 await f.getByTestId('theme-'+theme).check()
 await f.getByTestId('comicchat-nav').click()
 await f.getByTestId('comic-conversation').first().click()
 await card.waitFor()
 const frame=page.frames()[1]
 await frame.waitForFunction(t=>document.documentElement.dataset.theme===t,theme)
 assert.equal(await card.locator('[data-bubble-layout] p').textContent(),exact)
 const metrics=await card.evaluate(e=>{const c=getComputedStyle(e),b=getComputedStyle(e.querySelector('[data-bubble-layout]')),p=getComputedStyle(e.querySelector('[data-bubble-layout] p'));return{radius:c.borderRadius,shadow:c.boxShadow,bubble:b.borderRadius,fontSize:p.fontSize,text:p.color,paper:b.backgroundColor}})
 await incoming.waitFor()
 await incoming.locator('[data-comic-style="manga"]').waitFor()
 metrics.incomingBubble=await incoming.locator('[data-bubble-layout]').evaluate(e=>getComputedStyle(e).borderRadius)
 assert.ok(parseFloat(metrics.fontSize)>=16)
 metrics.contrast=contrast(metrics.text,metrics.paper);assert.ok(metrics.contrast>=7)
 const geom=await frame.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,iw:innerWidth,ih:innerHeight}))
 assert.ok(geom.w<=geom.iw+1&&geom.h<=geom.ih+1)
 await page.screenshot({path:evidence+'/'+theme+'-desktop.png'})
 await f.getByTestId('text-chat-toggle').click()
 assert.equal(await f.getByTestId('text-chat').locator('article p').first().textContent(),exact)
 await page.screenshot({path:evidence+'/'+theme+'-drawer.png'})
 await page.setViewportSize({width:390,height:844})
 assert.ok(await f.getByTestId('comic-composer').isVisible())
 assert.ok(await f.getByTestId('text-chat').isVisible())
 assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.screenshot({path:evidence+'/'+theme+'-mobile-text.png'})
 await f.getByTestId('text-chat-toggle').click()
 assert.ok(await card.isVisible())
 await page.screenshot({path:evidence+'/'+theme+'-mobile-comic.png'})
 await page.setViewportSize({width:1280,height:850})
 result.themes.push({theme,...metrics})
}
assert.equal(new Set(result.themes.map(t=>t.radius)).size,3)
assert.equal(new Set(result.themes.map(t=>t.bubble)).size,3)
assert.equal(new Set(result.themes.map(t=>t.incomingBubble)).size,3)
result.checks.push('Three distinct frame and bubble geometries, not only palette','Exact multiline original preserved in every theme and drawer','Body text >=16px and contrast >=7:1','Desktop viewport and 390px mobile composer fit')
await f.getByTestId('settings-nav').click()
await page.screenshot({path:evidence+'/settings.png'})
await f.getByTestId('ui-language').selectOption('ar')
assert.equal(await page.frames()[1].locator('html').getAttribute('dir'),'rtl')
await page.setViewportSize({width:390,height:844})
assert.equal(await page.frames()[1].evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
await page.screenshot({path:evidence+'/settings-ar-mobile.png'})
result.checks.push('Appearance preview picker and Arabic RTL at 390px')
assert.deepEqual(errors,[])
result.status='passed'
}catch(e){result.status='failed';result.error=e.stack;console.error(e.stack)}
finally{await fs.writeFile(evidence+'/result.json',JSON.stringify(result,null,2));await browser.close()}
if(result.status!=='passed')process.exitCode=1
console.log(JSON.stringify(result))
