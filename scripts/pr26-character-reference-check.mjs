import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) {
    throw new Error(`PR-26 invariant missing: ${label}`)
  }
}
const forbid = (source, needle, label) => {
  if (source.includes(needle)) {
    throw new Error(`PR-26 forbidden: ${label}`)
  }
}

const migration = read('supabase/migrations/20261008002500_pr26_character_reference.sql')
const edge = read('supabase/functions/comicchat-render/index.ts') + read('supabase/functions/_shared/comic-image-worker.ts')
const test = read('supabase/tests/pr26_character_reference_integration.sh')
const docs = read('docs/PR26_CHARACTER_REFERENCE_CONTINUITY.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

expect(migration, 'CREATE TABLE IF NOT EXISTS public.comic_character_reference', 'reference table')
expect(migration, 'PRIMARY KEY (user_id, conversation_id)', 'conversation-scoped reference key')
expect(migration, 'source_message_id UUID NOT NULL UNIQUE', 'one source message cannot back multiple references')
expect(migration, 'comic_character_reference_message_identity_fk', 'sender/conversation/message identity FK')
expect(migration, 'ON CONFLICT (user_id, conversation_id) DO NOTHING', 'immutable first-reference pin')
expect(migration, "source_job.status <> 'ready'", 'ready-only reference source')
expect(migration, "source_job.provider <> 'openai-image'", 'provider-bound reference source')
expect(migration, 'GRANT SELECT ON TABLE public.comic_character_reference TO service_role', 'service-only lookup')
expect(migration, 'comic_character_reference_service_role_select', 'service-role RLS lookup policy')
expect(migration, 'comic_pin_character_reference', 'trusted pin RPC')

expect(edge, "OpenAI, { toFile }", 'official SDK file helper')
expect(edge, "openai.images.edit({", 'provider-native reference edit')
expect(edge, "openai.images.generate({", 'generate fallback when no reference exists')
expect(edge, ".eq('user_id', message.sender_id)", 'sender-scoped lookup')
expect(edge, ".eq('conversation_id', message.conversation_id)", 'conversation-scoped lookup')
expect(edge, "character-reference.webp", 'private reference file conversion')
expect(edge, "character_reference_mode: referenceFile", 'safe reference-mode descriptor')
expect(edge, "'conversation-reference'", 'reference edit mode')
expect(edge, "'seed-profile'", 'first-frame generate mode')
expect(edge, "'comic_pin_character_reference'", 'post-success immutable pin')
expect(edge, 'Do not fall back from edit -> generate inside one attempt', 'one-provider-call attempt rule')
forbid(edge, 'input_fidelity:', 'unverified input_fidelity option for current model')
forbid(edge, 'getPublicUrl', 'public reference URL helper')
forbid(edge, 'createSignedUrl', 'signed reference URL helper')
forbid(edge, 'source_message_id: reference.', 'reference source ID in output descriptor')

expect(test, 'first AB reference', 'first reference integration')
expect(test, 'second AB frame', 'immutable reference integration')
expect(test, 'first AC reference', 'cross-conversation isolation integration')
expect(test, 'first B reference', 'per-sender reference integration')
expect(test, 'authenticated client unexpectedly read private character-reference metadata', 'client metadata denial')

expect(docs, 'same sender + same conversation', 'privacy scope documentation')
expect(docs, 'images.edit', 'provider-native edit documentation')
expect(docs, 'does not silently fall back', 'one-call billing rule documentation')
expect(roadmap, '| PR-26 |', 'roadmap PR-26 row')
expect(ci, '20261008002500_pr26_character_reference.sql', 'CI applies migration')
expect(ci, 'pr26_character_reference_integration.sh', 'CI runs integration')
expect(ci, 'npm run character:pr26', 'CI static gate')

console.log('PR-26 character reference continuity boundaries passed.')
