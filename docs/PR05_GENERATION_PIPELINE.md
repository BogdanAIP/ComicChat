# PR-05 — async generation queue and usage ledger

Date: 2026-10-05  
Base: `main@d3e95b71e8f1cc0d7d5bb644498531ceab1807c5`

PR-05 adds the transactional boundary needed for asynchronous comic generation without enabling an external image API or pretending personal ChatGPT plan billing is available.

## Transaction boundary

`comic_send_message` remains the only browser message-write path. For a newly persisted message it now creates, in the same PostgreSQL transaction:

- the single `comic_message` row;
- recipient receipts;
- exactly one `comic_generation_job`;
- the initial `comic_usage_ledger` event.

A replay with the same `(conversation_id, sender_id, client_nonce)` resolves to the same message and the same generation job. It does not create another charge/event.

## Sender attribution and privacy

Every generation job stores the persisted `sender_id`, `provider`, and `billing_source`. PR-05 fixes both provider fields to `mock`.

Authenticated clients receive sender-only, RLS-filtered SELECT access to their own generation jobs and ledger rows. They receive no direct INSERT/UPDATE/DELETE privileges on either table.

A conversation partner continues to see the shared `comic_message.status` through the existing private chat domain, but does not receive the sender's accounting rows.

## Trusted worker contract

Only PostgreSQL `service_role` may execute:

- `comic_claim_generation_job`;
- `comic_complete_generation_job`;
- `comic_fail_generation_job`.

Claims use `FOR UPDATE SKIP LOCKED`, a bounded lease, and one job per message. A crashed worker can be reclaimed after lease expiry. Attempts are bounded by `max_attempts` (3 by default, hard-limited to 1–5).

Worker state transitions update the same message:

`queued -> rendering -> ready | queued(retry) | failed`

No transition creates a second chat message and no provider is allowed to rewrite `original_text`.

## Usage ledger

The ledger records idempotent events by `(job_id, attempt_no, event_type)`:

- `queued`;
- `started`;
- `failed`;
- `retry_scheduled`;
- `succeeded`.

It also carries non-negative `billable_units` and `cost_microunits`. The PR-05 mock provider always reports zero for both.

## Provider boundary

`utils/generationProvider.mjs` introduces:

- `TemplateRendererProvider` — wraps the deterministic PR-04 renderer and preserves source text exactly;
- `MockProvider` — returns deterministic illustration metadata with `containsText: false` and zero billing;
- an explicit disabled `official-image` branch.

The mock provider has no network access, secret, clock, or randomness. It does not copy source text into generated-art output.

## Intentionally not shipped in PR-05

PR-05 does **not** include:

- a continuously running hosted dispatcher;
- OpenAI/other image API calls;
- API keys;
- public or signed media storage;
- real-money charging;
- ChatGPT-plan/Codex token sharing;
- user-triggered paid retry.

Therefore a deployed app with no separate trusted worker simply leaves generation jobs in `queued`, preserving the current deterministic TemplateRenderer placeholder. This is deliberate: the queue/accounting security boundary is verified before any external provider or billing is attached.

## Verification

`npm run pipeline:pr05` checks provider purity, disabled external provider behavior, database authorization boundaries, queue leases, retry limits, and CI coverage.

PostgreSQL integration additionally proves:

1. one message -> one generation job;
2. duplicate send -> same message/job and one initial ledger event;
3. only sender can read accounting;
4. authenticated browser cannot mutate/claim work;
5. service worker can claim -> retry -> complete;
6. stale lease cannot complete twice;
7. retryable failures become terminal after the configured attempt bound.
