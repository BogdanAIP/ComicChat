import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`PR-21 invariant missing: ${label}`)
}

const test = read('supabase/tests/pr21_load_abuse_concurrency.sh')
const docs = read('docs/PR21_LOAD_ABUSE_CONCURRENCY.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')
const pkg = read('package.json')

expect(test, 'seq 1 40', 'burst exceeds quota')
expect(test, 'A_OK', 'successful burst accounting')
expect(test, 'A_FAIL', 'rejected burst accounting')
expect(test, 'send_rate_limited', 'rate-limit rejection verification')
expect(test, 'BURST_JOBS', 'generation-job cardinality verification')
expect(test, 'BURST_QUEUED_LEDGER', 'queued-ledger cardinality verification')
expect(test, 'seq 1 20', 'parallel exact retry fan-out')
expect(test, 'RETRY_UNIQUE_IDS', 'exact retries converge on one message ID')
expect(test, 'client_nonce_conflict', 'conflicting nonce race')
expect(test, 'RACE_MESSAGES', 'conflicting race keeps one message')
expect(test, 'RACE_JOBS', 'conflicting race keeps one generation job')
expect(docs, 'not a throughput benchmark', 'non-benchmark scope')
expect(docs, 'does not', 'explicit non-goals')
expect(roadmap, '| PR-21 |', 'roadmap PR-21 row')
expect(ci, 'pr21_load_abuse_concurrency.sh', 'concurrency harness in CI')
expect(ci, 'npm run stress:pr21', 'static PR-21 gate in CI')
expect(pkg, '"stress:pr21"', 'package script')

console.log('PR-21 deterministic load/abuse concurrency boundary passed.')
