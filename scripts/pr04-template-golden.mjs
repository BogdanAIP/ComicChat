import assert from 'node:assert/strict'
import fs from 'node:fs'
import { renderTemplate } from '../utils/templateRenderer.mjs'

const fixtureUrl = new URL('../tests/golden/pr04-template-renderer.json', import.meta.url)
const fixture = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'))

assert.equal(fixture.renderer, 'TemplateRenderer')
assert.equal(fixture.version, 1)

for (const testCase of fixture.cases) {
  const actual = renderTemplate(testCase.input)

  assert.deepEqual(
    actual,
    testCase.expected,
    `golden mismatch: ${testCase.name}`
  )

  assert.equal(
    actual.text,
    testCase.input.text,
    `source text changed: ${testCase.name}`
  )

  assert.equal(
    actual.messageId,
    String(testCase.input.messageId),
    `message identity changed: ${testCase.name}`
  )
}

const optimistic = renderTemplate({
  messageId: 'temp-abc',
  text: 'Queued exactly ✨',
  mine: true,
  status: 'queued',
  optimistic: true,
})

assert.equal(optimistic.state.key, 'sending')
assert.equal(optimistic.text, 'Queued exactly ✨')

const preview = renderTemplate({
  messageId: 'draft:conversation',
  text: 'Draft stays exact',
  mine: true,
  status: 'failed',
  preview: true,
})

assert.equal(preview.state.key, 'draft')
assert.equal(preview.text, 'Draft stays exact')

console.log(`PR-04 TemplateRenderer golden tests passed: ${fixture.cases.length} fixtures.`)
