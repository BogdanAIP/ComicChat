import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

async function makeGroupAccounts() {
  const url = process.env.COMICCHAT_SUPABASE_URL
  const key = process.env.COMICCHAT_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Local group browser test needs Supabase admin environment')
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const suffix = Date.now().toString(36)
  const password = `GroupTest-${suffix}-Aa1!`
  const create = async (label) => {
    const email = `comicchat-pr36-${label}-${suffix}@example.com`
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (error || !data.user?.id) throw new Error(error?.message || 'Missing group test user')
    return { email, password }
  }
  return { a: await create('a'), b: await create('b') }
}

async function loginAndName(page, account, name) {
  await page.goto('/')
  await page.getByTestId('auth-email').fill(account.email)
  await page.getByTestId('auth-password').fill(account.password)
  await page.getByTestId('auth-submit').click()
  await expect(page.getByTestId('comic-private-shell')).toBeVisible()
  await page.getByTestId('profile-nav').click()
  const profile = page.getByTestId('profile-page')
  await expect(profile).toHaveAttribute('data-current-user-ready','true')
  await page.getByTestId('profile-edit-username').click()
  await page.getByTestId('profile-username-input').fill(name)
  await page.getByTestId('profile-save').click()
  await expect(page.getByTestId('comic-private-shell')).toBeVisible()
}

test('closed group messages appear as comics for invited participants without page reload', async ({ browser }) => {
  const accounts = await makeGroupAccounts()
  const suffix = Date.now().toString(36)
  const nickA = `pr36a-${suffix}`, nickB = `pr36b-${suffix}`
  const groupName = `Panel party ${suffix}`
  const firstText = `PR36 live group panel A ${suffix}`
  const replyText = `PR36 live group panel B ${suffix}`
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    await loginAndName(pageA, accounts.a, nickA)
    await loginAndName(pageB, accounts.b, nickB)

    await pageA.getByTestId('groups-nav').click()
    await expect(pageA.getByTestId('comic-group-shell')).toBeVisible()
    await pageA.getByLabel('New group name').fill(groupName)
    await pageA.getByLabel('Group visibility').selectOption('closed')
    await pageA.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(pageA.getByRole('heading', { name: groupName })).toBeVisible()

    await pageA.getByLabel('Find user to invite').fill(nickB)
    await pageA.getByRole('button', { name: `Invite ${nickB}` }).click()
    await expect(pageA.getByText('Invitation sent.')).toBeVisible()

    // The recipient joins voluntarily from the actual group UI.
    await pageB.getByTestId('groups-nav').click()
    const invite = pageB.getByText(groupName).first()
    await expect(invite).toBeVisible()
    await pageB.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(pageB.getByRole('heading', { name: groupName })).toBeVisible()

    await pageA.getByTestId('comic-group-composer').fill(firstText)
    await pageA.getByTestId('comic-group-send').click()

    const onB = pageB.locator('article[data-message-id]').filter({ hasText: firstText })
    await expect(onB).toHaveCount(1)
    await expect(onB.getByText(firstText,{exact:true})).toHaveCount(1)
    await expect(onB).not.toHaveAttribute('data-message-status','draft')

    await pageB.getByTestId('comic-group-composer').fill(replyText)
    await pageB.getByTestId('comic-group-send').click()
    const onA = pageA.locator('article[data-message-id]').filter({ hasText: replyText })
    await expect(onA).toHaveCount(1)
    await expect(onA.getByText(replyText,{exact:true})).toHaveCount(1)

    // A group participant creates a real closed-group comic from two existing
    // chat messages. The other member can read it; the public feed cannot.
    await pageB.getByTestId('group-story-studio').locator('summary').click()
    await pageB.getByLabel(`Include comic message ${firstText.slice(0,45)}`).check()
    await pageB.getByLabel(`Include comic message ${replyText.slice(0,45)}`).check()
    await pageB.getByLabel('Group story title').fill(`Our private comic ${suffix}`)
    await pageB.getByTestId('group-story-create').click()
    const localEpisode = pageB.getByTestId('group-story-episode')
    await expect(localEpisode).toContainText(`Our private comic ${suffix}`)
    await expect(localEpisode).toContainText(firstText)
    await expect(localEpisode).toContainText(replyText)
    await expect(pageB.getByTestId('group-story-publish')).toHaveCount(0)

    await pageA.getByTestId('group-story-studio').locator('summary').click()
    await pageA.getByRole('button', { name: 'Refresh stories' }).click()
    await expect(pageA.getByTestId('group-story-episode')).toContainText(`Our private comic ${suffix}`)
    await pageB.getByTestId('stories-nav').click()
    await expect(pageB.getByTestId('comic-story-feed')).not.toContainText(`Our private comic ${suffix}`)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
