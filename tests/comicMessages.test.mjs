import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeMessage, reusableSendAttempt } from '../utils/comicMessages.mjs'

test('a lost response can be retried after visiting another conversation without a second server message', () => {
  const originalText = '  Сохрани пробелы\n\n'
  const attempts = new Map()
  const committed = new Map()
  const send = (conversationId, text, loseResponse = false) => {
    const attempt = reusableSendAttempt(attempts.get(conversationId), conversationId, text)
    attempts.set(conversationId, attempt)
    const identity = `${conversationId}:${attempt.nonce}`
    if (!committed.has(identity)) committed.set(identity, { original_text: text })
    if (loseResponse) throw new Error('Response lost after commit')
    const row = committed.get(identity)
    attempts.delete(conversationId)
    return row
  }
  assert.throws(() => send('a', originalText, true), /Response lost/)
  send('b', 'A different conversation')
  assert.equal(send('a', originalText).original_text, originalText)
  assert.equal(committed.size, 2)
  send('a', originalText)
  assert.equal(committed.size, 3, 'a confirmed send allows a deliberate new identical message')
})

test('an edited draft gets a separate identity, while an unchanged retry retains it', () => {
  const original = reusableSendAttempt(null, 'a', 'One line')
  assert.equal(reusableSendAttempt(original, 'a', 'One line'), original)
  assert.notEqual(reusableSendAttempt(original, 'a', 'Another line').nonce, original.nonce)
  assert.notEqual(reusableSendAttempt(original, 'b', 'One line').nonce, original.nonce)
})

test('realtime confirmation replaces its optimistic card and stale reads cannot regress artwork state', () => {
  const saved = {
    id: 'saved', sender_id: 'me', client_nonce: 'same-nonce', original_text: '  Exact\n\n',
    created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:01:00Z',
    status: 'ready', style: { primary_style_id: 'anime' },
  }
  const optimistic = { ...saved, id: 'temp-same-nonce', status: 'queued', optimistic: true }
  const confirmed = mergeMessage([optimistic], saved)
  assert.equal(confirmed.length, 1)
  assert.equal(confirmed[0].id, 'saved')
  assert.equal(confirmed[0].original_text, saved.original_text)
  const stale = { ...saved, status: 'rendering', updated_at: '2026-10-09T00:00:30Z' }
  assert.equal(mergeMessage(confirmed, stale)[0].status, 'ready')
  const { style, ...sendResponse } = saved
  assert.deepEqual(mergeMessage(confirmed, sendResponse)[0].style, style)
})
