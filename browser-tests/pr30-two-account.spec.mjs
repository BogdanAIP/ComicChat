import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const existingAccounts = {
  a: {
    email: process.env.COMICCHAT_TEST_USER_A_EMAIL || '',
    password: process.env.COMICCHAT_TEST_USER_A_PASSWORD || '',
  },
  b: {
    email: process.env.COMICCHAT_TEST_USER_B_EMAIL || '',
    password: process.env.COMICCHAT_TEST_USER_B_PASSWORD || '',
  },
}

function haveDedicatedAccounts() {
  return Object.values(existingAccounts).every(
    (account) => account.email && account.password
  )
}

async function createEphemeralAccounts() {
  const supabaseUrl = process.env.COMICCHAT_SUPABASE_URL
  const serviceRoleKey = process.env.COMICCHAT_SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Browser acceptance needs either two dedicated test accounts or local Supabase admin credentials.'
    )
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const suffix = `${Date.now().toString(36)}-${process.pid}`
  const password = `Pr30-${suffix}-Aa1!`

  const create = async (label) => {
    const email = `comicchat-pr30-${label}-${suffix}@example.com`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (error || !data.user?.id) {
      throw new Error(
        `Unable to create local browser user ${label}: ${error?.message || 'missing user'}`
      )
    }

    return { email, password }
  }

  return {
    a: await create('a'),
    b: await create('b'),
  }
}

async function login(page, account) {
  await page.goto('/en')
  await page.getByTestId('auth-email').fill(account.email)
  await page.getByTestId('auth-password').fill(account.password)
  await page.getByTestId('auth-submit').click()

  await expect(page.getByTestId('comic-private-shell')).toBeVisible()
  await expect(page.getByTestId('comicchat-nav')).toBeVisible()
}

async function setUsername(page, username) {
  await page.getByTestId('profile-nav').click()

  const profile = page.getByTestId('profile-page')
  await expect(profile).toBeVisible()
  await expect(profile).toHaveAttribute('data-current-user-ready', 'true')

  await page.getByTestId('profile-edit-username').click()
  await page.getByTestId('profile-username-input').fill(username)
  await page.getByTestId('profile-save').click()

  await expect(page.getByTestId('comic-private-shell')).toBeVisible()
}

async function openConversation(page, username) {
  await page.getByTestId('comic-user-search').fill(username)

  const result = page
    .getByTestId('comic-search-result')
    .filter({ hasText: username })

  await expect(result).toHaveCount(1)
  await result.click()

  await expect(page.getByTestId('comic-chat-title')).toHaveText(username)
  await expect(page.getByTestId('comic-connection')).toHaveText('Live')
}

function messageCard(page, exactText) {
  return page
    .locator('article[data-message-id]')
    .filter({ hasText: exactText })
}

test('two users exchange exact private messages through the browser in realtime', async ({ browser }) => {
  const accounts = haveDedicatedAccounts()
    ? existingAccounts
    : await createEphemeralAccounts()

  const suffix = Date.now().toString(36)
  const usernameA = `pr30-alpha-${suffix}`
  const usernameB = `pr30-bravo-${suffix}`
  const aToB = `PR30 exact A-to-B ${suffix}`
  const bToA = `PR30 exact B-to-A ${suffix}`

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    await login(pageA, accounts.a)
    await login(pageB, accounts.b)

    await setUsername(pageA, usernameA)
    await setUsername(pageB, usernameB)

    await openConversation(pageA, usernameB)
    await openConversation(pageB, usernameA)

    await pageA.getByTestId('comic-composer').fill(aToB)
    await pageA.getByTestId('comic-send').click()
    await expect(pageA.getByTestId('comic-composer')).toHaveValue('')

    const receivedByB = messageCard(pageB, aToB)
    await expect(receivedByB).toHaveCount(1)
    await expect(receivedByB.getByText(aToB, { exact: true })).toHaveCount(1)
    await expect(receivedByB).not.toHaveAttribute('data-message-status', 'draft')

    await pageB.getByTestId('comic-composer').fill(bToA)
    await pageB.getByTestId('comic-send').click()
    await expect(pageB.getByTestId('comic-composer')).toHaveValue('')

    const receivedByA = messageCard(pageA, bToA)
    await expect(receivedByA).toHaveCount(1)
    await expect(receivedByA.getByText(bToA, { exact: true })).toHaveCount(1)
    await expect(receivedByA).not.toHaveAttribute('data-message-status', 'draft')
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
