import { test, expect } from '@playwright/test'

// Deterministic frontend fixtures. These tests verify layout/accessibility and
// request wiring; native SQL and two-account suites verify backend permissions.
const ME = '39000000-0000-4000-8000-000000000001'
const PARTNER = '39000000-0000-4000-8000-000000000002'
const DIRECT = '39000000-0000-4000-8000-000000000003'
const GROUP = '39000000-0000-4000-8000-000000000004'
const REQUEST = '39000000-0000-4000-8000-000000000005'
const CUTOFF = '39000000-0000-4000-8000-000000000006'
const frozenText = 'An older message outside the currently loaded chat page.  '
const style = { primary_style_id: 'anime', secondary_style_id: null, secondary_weight: 0, style_version: 1 }

export async function fixtureChat(page, { failedPreview = false } = {}) {
  const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'audit-ui@example.com',
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-09T00:00:00Z' }
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: ME, aud: 'authenticated', role: 'authenticated', exp: expiresAt })).toString('base64url'), 'fixture'].join('.')
  const session = { access_token: token, refresh_token: 'audit-ui-fixture', expires_at: expiresAt,
    expires_in: 3600, token_type: 'bearer', user }
  const host = new URL(process.env.COMICCHAT_SUPABASE_URL || 'https://placeholder.supabase.co').hostname.split('.')[0]
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
    { key: `sb-${host}-auth-token`, session })
  let consent = false
  const calls = []
  const rows = (conversationId) => Array.from({ length: 8 }, (_, index) => ({
    id: `39000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
    conversation_id: conversationId, sender_id: index % 2 ? ME : PARTNER,
    original_text: `Panel ${index}: A message that must remain fully readable.\nSecond line with punctuation 🙂`,
    status: 'ready', created_at: `2026-10-09T00:0${index}:00Z`, updated_at: `2026-10-09T00:0${index}:00Z`, style,
  }))
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' }
  await page.route('**/auth/v1/**', (route) => route.fulfill({ headers, json: route.request().url().includes('/token') ? session : user }))
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const name = url.pathname.split('/').pop()
    const args = request.method() === 'POST' ? request.postDataJSON() || {} : {}
    calls.push({ name, args })
    const payload = {
      user: { id: ME, username: 'Audit reader', email: user.email },
      comic_list_direct_conversations: [{ conversation_id: DIRECT, other_user_id: PARTNER,
        other_username: 'Audit partner', last_message_text: 'Open this conversation', unread_count: 0 }],
      comic_list_groups: [{ conversation_id: GROUP, title: 'Audit group', visibility: 'closed',
        adult_theme: false, member_count: 2, member_role: 'owner', owner_id: ME }],
      comic_list_group_members: [{ user_id: ME, username: 'Audit reader', member_role: 'owner' },
        { user_id: PARTNER, username: 'Audit partner', member_role: 'member' }],
      comic_get_my_account_state: [{ status: 'active' }],
      comic_get_beta_safety_status: [{ external_generation_enabled: false, media_storage_enabled: false,
        public_publication_enabled: true, generation_provider: 'mock' }],
      comic_get_conversation_style: style,
      comic_read_message_page: rows(args.p_conversation_id),
      comic_list_public_snapshot_requests: [{ request_id: REQUEST, through_message_id: CUTOFF,
        requested_by: PARTNER, my_consented: consent, all_members_consented: consent, sharing_eligible: true }],
      comic_read_publication_preview: [{ id: CUTOFF, speaker: 'Audit partner', text: frozenText, style }],
    }[name]
    if (name === 'comic_set_public_snapshot_consent') consent = args.p_consented
    if (name === 'comic_read_publication_preview' && failedPreview) {
      return route.fulfill({ headers, status: 403, json: { code: '42501', message: 'snapshot_forbidden' } })
    }
    return route.fulfill({ headers, json: payload ?? [] })
  })
  // No real realtime connection or production data leaves this test page.
  await page.routeWebSocket('**/realtime/v1/websocket*', (socket) => { socket.onMessage(() => {}) })
  await page.goto('/en')
  await expect(page.getByTestId('comic-private-shell')).toBeVisible()
  return { calls }
}

async function navigate(page, testId) {
  const button = page.getByTestId(testId)
  if (!(await button.isVisible())) await page.getByRole('button', { name: 'Open Menu', exact: true }).click()
  await button.click()
}

export async function geometry(page, composerId, sendId) {
  await expect(page.getByTestId(composerId)).toBeInViewport()
  await expect(page.getByTestId(sendId)).toBeInViewport()
  const metrics = await page.locator('article[data-message-id]').evaluateAll((cards) => cards.map((card) => {
    const bubble = card.querySelector('[data-bubble-layout]')
    const outer = card.getBoundingClientRect(), inner = bubble.getBoundingClientRect()
    return { id: card.dataset.messageId, outer: outer.height, scroll: card.scrollHeight,
      client: card.clientHeight, bubbleInside: inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1 }
  }))
  for (const metric of metrics) {
    expect(metric.bubbleInside, JSON.stringify(metric)).toBe(true)
    expect(metric.scroll, JSON.stringify(metric)).toBeLessThanOrEqual(metric.client + 2)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  return metrics
}

for (const width of [1440, 390]) {
  test(`direct/group panels and composers remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await fixtureChat(page)
    await page.getByTestId('comic-conversation').click()
    await expect(page.getByTestId('comic-messages').locator('article[data-message-id]')).toHaveCount(8)
    await page.getByTestId('comic-composer').fill('  Exact draft\nA new line  ')
    await geometry(page, 'comic-composer', 'comic-send')
    await page.locator('details[aria-label="Comic message preview"]').locator('summary').click()
    await geometry(page, 'comic-composer', 'comic-send')
    await navigate(page, 'groups-nav')
    await page.getByTestId('comic-group-entry').click()
    await expect(page.getByTestId('comic-group-messages').locator('article[data-message-id]')).toHaveCount(8)
    await page.getByTestId('comic-group-composer').fill('A group draft')
    await geometry(page, 'comic-group-composer', 'comic-group-send')
    const client = await page.context().newCDPSession(page)
    await client.send('DOM.enable')
    await client.send('CSS.enable')
    await client.send('Performance.enable')
    const dom = await client.send('DOM.getDocument', { depth: 1 })
    const performance = await client.send('Performance.getMetrics')
    expect(dom.root.nodeName).toBe('#document')
    expect(performance.metrics.some((metric) => metric.name === 'Nodes')).toBe(true)
    await client.detach()
  })
}

test('an old consent request loads its frozen snapshot before approval and can be revoked', async ({ page }) => {
  const { calls } = await fixtureChat(page)
  await page.getByTestId('comic-conversation').click()
  await page.locator('details').filter({ has: page.getByTestId('comic-story-permissions') }).locator('summary').first().click()
  await expect(page.getByTestId('comic-story-approve')).toBeDisabled()
  await page.getByTestId('comic-story-request-card').locator('summary').click()
  await expect(page.getByTestId('comic-story-snapshot')).toContainText(frozenText.trimEnd())
  await page.getByTestId('comic-story-approve').click()
  await page.getByTestId('comic-story-revoke').click()
  expect(calls.filter((call) => call.name === 'comic_set_public_snapshot_consent').map((call) => call.args.p_consented)).toEqual([true, false])
})

test('preview failure keeps publication approval disabled', async ({ page }) => {
  await fixtureChat(page, { failedPreview: true })
  await page.getByTestId('comic-conversation').click()
  await page.locator('details').filter({ has: page.getByTestId('comic-story-permissions') }).locator('summary').first().click()
  await page.getByTestId('comic-story-request-card').locator('summary').click()
  await expect(page.getByTestId('comic-story-approve')).toBeDisabled()
  await expect(page.getByTestId('comic-story-permissions').getByRole('alert')).toContainText('snapshot could not be loaded')
})

test('mobile menu excludes hidden controls and Arabic auth has Arabic text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixtureChat(page)
  await expect(page.getByTestId('groups-nav')).not.toBeVisible()
  await page.getByRole('button', { name: 'Open Menu', exact: true }).click()
  await expect(page.getByTestId('groups-nav')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('groups-nav')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Menu', exact: true })).toBeFocused()
  await page.evaluate(() => localStorage.clear())
  await page.unroute('**/auth/v1/**')
  const signedOut = await page.context().newPage()
  await signedOut.goto('/ar')
  await expect(signedOut.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(signedOut.getByTestId('auth-submit')).toHaveText('تسجيل الدخول')
})
