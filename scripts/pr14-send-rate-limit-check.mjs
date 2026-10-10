import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}

function expect(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`PR-14 invariant missing: ${label}`)
  }
}

const migration = read('supabase/migrations/20261006211500_pr14_send_rate_limit.sql')
const test = read('supabase/tests/pr14_send_rate_limit_integration.sh')
const chat = read('components/ComicDirectMessages.js')
const docs = read('docs/PR14_SEND_RATE_LIMIT.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

expect(migration, 'comic_message_sender_created_idx', 'sender/time lookup index')
expect(migration, 'pg_advisory_xact_lock', 'per-sender transactional lock')
expect(migration, 'hashtextextended(me::TEXT, 0)', 'stable per-sender advisory key')
expect(migration, "CURRENT_TIMESTAMP - INTERVAL '60 seconds'", 'rolling one-minute window')
expect(migration, 'recent_message_count >= 30', 'closed-beta message threshold')
expect(migration, "RAISE EXCEPTION 'send_rate_limited'", 'explicit rate-limit error')
expect(migration, "HINT = 'retry_after_seconds=60'", 'retry hint')
expect(migration, 'public.comic_enqueue_generation_for_message(', 'generation enqueue preserved')
expect(migration, "RAISE EXCEPTION 'interaction_blocked'", 'blocking boundary preserved')
expect(migration, "RAISE EXCEPTION 'client_nonce_conflict'", 'nonce conflict preserved')

const lockIndex = migration.indexOf('pg_advisory_xact_lock')
const retryIndex = migration.indexOf('SELECT *\n    INTO existing_message')
const countIndex = migration.indexOf('SELECT COUNT(*)')
if (!(lockIndex >= 0 && retryIndex > lockIndex && countIndex > retryIndex)) {
  throw new Error('PR-14 invariant missing: lock -> idempotency lookup -> rate count ordering')
}

expect(test, 'seq 1 30', 'thirty successful new sends')
expect(test, '31st new message inside the rolling minute unexpectedly succeeded', '31st-send rejection')
expect(test, 'RETRY_ID=', 'retry remains valid at cap')
expect(test, 'other sender remains independent', 'per-sender isolation')
expect(test, "created_at = created_at - INTERVAL '61 seconds'", 'window expiry coverage')

expect(chat, "includes('send_rate_limited')", 'web recognizes server rate limit')
expect(chat, 'setDraft((current) => current || originalText)', 'web preserves draft on rate limit')
expect(docs, '30 new messages per rolling 60 seconds', 'documented beta threshold')
expect(docs, 'idempotent retries do not consume', 'documented retry semantics')
expect(roadmap, '| PR-14 |', 'roadmap PR-14 row')
expect(ci, '20261006211500_pr14_send_rate_limit.sql', 'CI applies PR-14 migration')
expect(ci, 'pr14_send_rate_limit_integration.sh', 'CI runs PR-14 integration')
expect(ci, 'npm run safety:pr14', 'CI runs PR-14 static gate')

console.log('PR-14 atomic send rate-limit boundaries passed.')
