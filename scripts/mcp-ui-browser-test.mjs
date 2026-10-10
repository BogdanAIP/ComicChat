import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const source = await fs.readFile('supabase/functions/comicchat-mcp/ui.ts', 'utf8')
const html = JSON.parse(source.slice(source.indexOf(' = ') + 3))
const fixture = await fs.readFile('mcp-ui/qa-host-script.js', 'utf8')
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comicchat-widget-'))
const host = path.join(dir, 'host.html')
await fs.writeFile(host, '<!doctype html><html><body><script>' + fixture +
  '</script><iframe style="width:1100px;height:800px;border:0" srcdoc="' +
  html.replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"></iframe></body></html>')
const browser = await chromium.launch({ headless: true, channel: process.env.MCP_UI_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(pathToFileURL(host).href)
  const frame = page.frameLocator('iframe')
  await frame.getByTestId('comicchat-nav').waitFor()
  await frame.getByTestId('groups-nav').click()
  await frame.getByTestId('comic-group-shell').waitFor()
  await frame.getByRole('textbox', { name: 'New group name' }).fill('GPT QA Group')
  await frame.getByRole('button', { name: 'Create', exact: true }).click()
  await frame.getByTestId('comic-group-entry').filter({ hasText: 'GPT QA Group' }).waitFor()
  await frame.getByTestId('comic-group-composer').fill('Привет группе из GPT')
  await frame.getByRole('button', { name: 'Send ✦', exact: true }).click()
  await frame.locator('article[data-message-id="00000000-0000-4000-a000-000000000037"]').waitFor()
  const send = await page.evaluate(() => window.qaCalls.find(c => c.arguments?.request?.operation === 'comic_send_message'))
  assert.equal(send.arguments.request.args.p_original_text, 'Привет группе из GPT')
  await frame.getByTestId('comic-group-composer').fill('Alpha private draft')
  await page.evaluate(() => window.qaSwitchAccount())
  await frame.getByTestId('comicchat-nav').waitFor()
  const text = await page.frames()[1].locator('body').innerText()
  assert.ok(text.includes('gpt-bravo-20261010@comicchat.test'))
  assert.ok(!text.includes('gpt-alpha-20261010@comicchat.test'))
  assert.equal(await frame.getByTestId('comic-group-composer').count(), 0)
  await frame.getByTestId('groups-nav').click()
  await frame.getByTestId('comic-group-entry').filter({ hasText: 'GPT QA Group' }).click()
  await frame.getByTestId('comic-group-composer').waitFor()
  assert.equal(await frame.getByTestId('comic-group-composer').inputValue(), '')
  assert.deepEqual(errors, [])
  console.log('Shared website UI, MCP handshake, group creation/send and account remount: PASS (fixture host)')
} finally {
  await browser.close()
  await fs.rm(dir, { recursive: true, force: true })
}
