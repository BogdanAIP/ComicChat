# PR-25 — opt-in real comic art with private storage

Date: 2026-10-07  
Base: `main@3ee73d7a079617b819bd89c4d0294628862678a7`

## Goal

Turn the existing MockProvider pipeline into the shortest safe path to real comic art without replacing ComicChat's tested message, queue, privacy, or accounting model.

This is a reuse-first vertical slice:

```text
comic_send_message
  -> existing comic_generation_job / comic_usage_ledger
  -> sender-authenticated comicchat-render Edge Function
  -> official OpenAI Images SDK
  -> private Supabase Storage bucket
  -> authenticated participant download
  -> existing ComicPanel + exact DOM text overlay
```

ComicChat remains a separate product. Rakazo Market/Skills were used to guide development, not added as runtime dependencies.

## Reuse decision

### Market Resolver

The live Rakazo Market Resolver had no relevant image-generation/private-media implementation for this ComicChat task.

### Market Skills

The live Market had useful development Skills such as `review-duplication` and Chrome DevTools workflows, but no task-specific OpenAI image-generation Skill that replaced the provider integration.

### Official implementations selected

Rather than build an image stack:

- use the official OpenAI JavaScript/TypeScript SDK from the Supabase Deno Edge Function;
- use the OpenAI Images API, which returns base64-encoded image bytes;
- use Supabase private Storage for the resulting bytes;
- use Supabase Storage RLS for conversation-member read authorization;
- keep the existing ComicChat GenerationJob/UsageLedger and message state machine.

The provider uses `gpt-image-2.5-flare` by default, low quality, square WebP output. The model lives in server-side configuration and can be changed without changing message semantics.

References:
- OpenAI image generation: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI Images API: https://developers.openai.com/api/reference/resources/images
- Supabase private buckets: https://supabase.com/docs/guides/storage/buckets/fundamentals

## Opt-in provider gate

Real external generation is **disabled by default**.

`public.comic_generation_config` starts with:

- `external_generation_enabled = false`;
- provider `openai-image`;
- billing source `comicchat-sponsored-beta`;
- model `gpt-image-2.5-flare`.

While disabled, new messages continue to create `mock|mock` generation jobs exactly as before.

Enabling the provider is an explicit deployment operation and also requires `OPENAI_API_KEY` in the trusted Edge Function environment. No key is committed to the repository.

Example operator-side activation after the deployment has a reviewed API key:

```sql
UPDATE public.comic_generation_config
SET
  external_generation_enabled = TRUE,
  provider = 'openai-image',
  billing_source = 'comicchat-sponsored-beta',
  model = 'gpt-image-2.5-flare',
  updated_at = NOW()
WHERE singleton_id = 1;
```

Disable it immediately with:

```sql
UPDATE public.comic_generation_config
SET external_generation_enabled = FALSE, updated_at = NOW()
WHERE singleton_id = 1;
```

This configuration is not readable or writable by ordinary authenticated clients.

## Sender authorization and spend isolation

The web app invokes `comicchat-render` only for the authenticated sender's own queued messages.

The Edge Function first authenticates the bearer token, then reads `comic_generation_job` through sender-only RLS. Only after that check does a separate service-role client claim the exact `message_id`.

The service-only `comic_claim_generation_job_for_message` RPC avoids a user-triggered function accidentally claiming another user's oldest global queue item.

Therefore:

- a conversation partner can see the shared message but cannot trigger the sender's provider spend;
- a foreign user cannot trigger the generation job;
- duplicate render dispatches are idempotent around the exact job lease.

## Private media

When Supabase Storage exists, migration PR-25 creates `comicchat-art` as a **private** bucket.

The object path is deterministic:

```text
<conversation_id>/<message_id>.webp
```

The path is not stored in the user-visible generation descriptor. Both IDs are already authorized ComicChat domain identifiers.

Storage RLS permits `SELECT` only if the authenticated caller is a member of the conversation represented by the first path segment.

There is intentionally:

- no authenticated browser INSERT/UPDATE/DELETE policy;
- no public bucket;
- no `getPublicUrl`;
- no signed-URL layer in this first slice;
- no client attachment upload.

The trusted service-role render worker owns media writes.

## Output descriptor

The existing PR-19 fail-closed descriptor guard stays active. A successful job stores only locator-free metadata such as:

```json
{
  "illustration": {
    "kind": "private-comic-art",
    "version": 1,
    "asset_id": "<message-id>",
    "mime_type": "image/webp",
    "containsText": false,
    "model": "gpt-image-2.5-flare"
  }
}
```

No URL, bucket name, object key, storage key, signed URL, or provider response body is exposed there.

## Exact text and prompt privacy

The stored `comic_message.original_text` remains canonical and unchanged.

When external generation is enabled, the trusted worker sends the message text to the configured OpenAI image provider only as private **scene context**. The generated image is explicitly requested to contain no letters, words, numbers, captions, labels, logos, watermarks, or speech bubbles.

ComicPanel then overlays the exact original message text in the existing programmatic speech bubble.

The UI discloses this external-provider behavior when generation is enabled.

The worker does not log:

- original message text;
- provider API keys;
- bearer tokens;
- worker lease tokens;
- base64 image content.

## Character/style continuity baseline

PR-25 deliberately does not invent a custom identity model or reference-image database.

For the first real vertical slice, the worker derives a stable fictional character description from `sender_id` and a stable art style from `conversation_id`. This gives deterministic prompt-level continuity while preserving the fastest path to a usable product.

Provider-native reference-image editing should be evaluated as a later reuse-first improvement if visual continuity is not sufficient in beta testing.

## Billing semantics

`comicchat-sponsored-beta` means ComicChat's configured API account is the provider billing source for this closed-beta path.

PR-25 does **not** claim that a user's ChatGPT subscription or ChatGPT plan allowance pays for image generation.

A successful attempt records one billable provider image unit. `cost_microunits = 0` means no end-user ComicChat charge is assigned in this sponsored-beta mode; it is not an assertion that the provider API itself costs zero.

## Failure behavior

Provider or storage failure never deletes or rewrites the message.

The existing job lease/retry state machine moves the same message through:

`queued -> rendering -> ready | queued(retry) | failed`

If the private image cannot be downloaded, ComicPanel falls back to the deterministic TemplateRenderer placeholder while continuing to show the exact original text.

## Verification

PR-25 adds:

- PostgreSQL integration for default-off provider selection, explicit activation, exact-message claim, sender config isolation, and safe disable;
- local Supabase Storage integration proving A/B can read one private conversation asset while user C and anonymous callers cannot;
- browser-upload denial;
- private-bucket assertion;
- static checks for official OpenAI SDK usage, private authenticated download, absence of public/signed URL helpers, descriptor locator safety, and secret/private-data logging constraints.

No real OpenAI API call is made by CI.
