# PR-04 — TemplateRenderer and golden visual models

Date: 2026-10-05  
Base: `main@3c9c799fd977a5a7a43cd57be2f28ec848f97874`

PR-04 formalizes the non-AI renderer boundary. It does not add an external image provider, generation job, billing, asset storage or a second message record.

## TemplateRenderer contract

`renderTemplate(input)` is deterministic and side-effect-free. Its output contains:

- `renderer` and version;
- unchanged `messageId` and exact `text`;
- incoming/outgoing side;
- deterministic scene key, symbol, pose and seed;
- deterministic character slot/anchor/template token;
- bubble layout metrics;
- visual state descriptor.

The renderer uses no network calls, Supabase client, browser globals, wall clock or randomness.

## Message identity

Renderer output is presentation data only. It does not create or mutate a chat record.

PR-02/PR-03 identity still applies:

- optimistic send uses `temp-<client_nonce>`;
- persisted message uses `comic_message.id`;
- optimistic and persisted rows converge through `client_nonce + sender_id`;
- one logical message occupies one visual card.

## Exact text

`renderTemplate` converts the input to a string and carries that exact string to `renderModel.text`.

It does not trim, truncate, summarize, translate or paraphrase the source text. `ComicPanel` renders `renderModel.text` and the existing copy action copies that exact value.

## Bubble layout

The renderer exposes three stable layout classes:

- `compact` for short content;
- `standard` for typical or multi-line content;
- `expansive` for long/high-line-count content.

Each class returns deterministic max width, minimum height, font scale and padding. The render model also records character count, line count, emoji count and logical text direction.

The UI consumes those metrics directly. Mixed-direction speech uses logical `dir`, `unicode-bidi: plaintext`, and `text-align: start`.

## Golden fixtures

`tests/golden/pr04-template-renderer.json` stores full expected renderer descriptors for:

1. short outgoing ready message;
2. multiline incoming rendering message;
3. emoji incoming queued message;
4. RTL incoming failed message;
5. long outgoing ready message.

`scripts/pr04-template-golden.mjs` deep-compares live renderer output to every stored descriptor and separately verifies optimistic and composer-preview states.

This is intentionally a **visual-model golden** rather than a screenshot golden. It gives stable deterministic coverage without introducing browser screenshot infrastructure before the renderer/provider layer exists.

## CI boundary

`npm run renderer:pr04` runs:

1. `scripts/pr04-renderer-check.mjs` — purity, renderer consumption, layout and fixture coverage;
2. `scripts/pr04-template-golden.mjs` — deterministic deep-equality goldens.

All PR-02 database/realtime and PR-03 comic-first/accessibility gates remain unchanged.

## Gate to PR-05

PR-05 may add the async generation pipeline and usage ledger, but provider output must map back onto this same message/card identity. Provider failures must not delete or rewrite the original source text.
