# ComicChat — архитектурные границы (первичная версия)

Эта записка фиксирует **цель**, а не приписывает форку уже реализованные возможности.

## Контуры

```text
Web UI  --------------------------+
                                     +--> ComicChat application API --> persistence adapter --> DB/media store
ChatGPT plugin UI --> MCP adapter ---+                                  |
                                                                         +--> messaging/realtime
                                                                         +--> GenerationJob queue
                                                                                  |
                                                                                  +--> Renderer provider
                                                                                  +--> Usage ledger (per sender)
```

MCP — дополнительная интеграционная поверхность, не база данных соцсети. История у Web и ChatGPT plugin общая. Хостинг ChatGPT Sites — кандидат, его runtime compatibility требует spike; backend/interfaces не должны жёстко зависеть от одного провайдера. До миграции исходник использует Next.js/React/Supabase.

## Минимальная схема предметной области

- `users(id, display_name, auth_binding, preferences)`; `auth_binding` не содержит токен в выдаче клиенту.
- `conversations(id, style_id, scene_state, privacy)`; `memberships(conversation_id, user_id, role)`.
- `characters(id, owner_id, reference_asset_id, traits, version)`.
- `messages(id, conversation_id, sender_id, client_nonce, original_text, status, created_at, updated_at)`.
- `render_jobs(id, message_id, sender_id, provider, billing_source, status, attempt, error_code)`.
- `assets(id, message_id, variant, storage_key, access_policy, created_at)`.
- `usage_ledger(id, sender_id, message_id, render_job_id, provider, billing_source, external_usage_ref, state)`.
- `publication_consents(message_id, user_id, granted_at, revoked_at)` only when optional public publishing ships.

SQL implementation and row-level permissions depend on chosen DB; model above is provider-independent.

## Send lifecycle

1. Client generates a unique nonce, submits original text + conversation ID; backend authenticates membership and inserts exactly one message and render job.
2. Client instantly shows one visual pending card; recipient receives the same message event.
3. Provider produces **art-only** scene; app deterministically overlays source text in a bubble. Exact Unicode text is retained, not substituted with a model rewrite.
4. Artifact stored privately; message transitions `queued -> rendering -> ready` (or `failed`) and clients replace the same card in-place.
5. On retries and reconnect, message ID and nonce deduplicate requests. Provider billing attribution always uses sender ID and explicit authorised billing source.
6. Failure yields a visual fallback panel displaying the verbatim message, and a bounded retry path. No charge switch without user approval.

## Authorization, privacy and cost

- Check conversation membership on all message, asset and event reads, not just in UI; prevent IDOR/cross-chat media URLs.
- Keep OAuth tokens server-side in encrypted/managed storage; do not place them in frontend bundles, URLs, logs or source control.
- Sender-pay is a **product invariant**, not an already-available third-party permission. The separately documented ChatGPT Plan Usage preview does not support image generation as of the plan date. Codex imagegen in a first-party/local Codex environment is not sufficient evidence of permission to expose hosted social image generation via user subscriptions.
- TemplateRenderer is baseline fallback; official image API provider may have separate billing with consent. Implement provider swap without rewriting messages.
- Only authors can trigger regeneration of their own messages; edits and published variants need versioning and consistent consent.
- Private-by-default; consider content moderation, opt-in publication, block/report/delete and data retention before public beta.

## Decisions pending a proof

| Decision | Current position | Evidence required |
|---|---|---|
| Host on ChatGPT Sites | Preferred candidate | Two-browser realtime + private media + Next compatibility + backup/restore smoke |
| Migrate Supabase to D1/R2 | Conditional | Migration mapping, auth/RLS equivalent, actual deploy success |
| Sign in with ChatGPT | Intended | Available registration path for hosted app + two-account OAuth test |
| Charge user ChatGPT/Codex allowance for generated image | Research only | Official authorized API/scope/tool + accounting test; no internal endpoint reuse |
| ChatGPT Plugin Extensions | Planned | Working MCP UI in each supported client + deep-link/reconnect test |

## Project boundary

ComicChat is a separate repository and product. Do not pull in unrelated local execution infrastructure or dependencies from other projects just to build the chat. Keep the original upstream [MIT License](../LICENSE) and preserved [README](UPSTREAM_README.md).
