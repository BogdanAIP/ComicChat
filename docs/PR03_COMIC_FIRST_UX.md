# PR-03 — Comic-first composer and accessible panels

Date: 2026-10-05  
Base: `main@dfe6fcb5c7395452e493f2ad1967884678724dc7`

PR-03 changes presentation only. The secure PR-02 domain, RPC boundaries, idempotency, RLS and private Broadcast remain the data/authorization foundation.

## One logical message, one visual slot

Private message history no longer renders ordinary text bubbles. Both optimistic and persisted messages use the same `ComicPanel` component.

The existing PR-02 identity rules stay unchanged:

- optimistic ID: `temp-<client_nonce>`;
- persisted ID: `comic_message.id`;
- `mergeMessage` removes the optimistic row when the persisted row with the same `client_nonce + sender_id` arrives;
- Realtime remains an invalidation signal and reloads persisted rows.

The visual placeholder therefore does not create a second chat message or a second server record.

## Comic-first composer

While the textarea contains a draft, the composer shows a visual `ComicPanel` preview using a deterministic `draft:<conversation_id>` presentation key. Sending removes the draft preview and immediately inserts the optimistic visual card into history.

No image provider is called. PR-03 is intentionally a deterministic demo layer.

## Panel states

`ComicPanel` presents the existing message status contract:

- `queued`
- `rendering`
- `ready`
- `failed`

Optimistic sends show a separate local `sending` presentation state.

For a persisted `failed` message, **Retry preview** only animates a local demo state on the same card and same `message_id`. It does not call an RPC and does not mutate server status. Real render retry belongs to the async generation pipeline milestone.

## Exact source text

The speech bubble renders the supplied message text without trimming, truncating or rewriting it.

**Copy original text** calls `navigator.clipboard.writeText(exactText)`, where `exactText` is the string value of `comic_message.original_text`. The action does not use `.trim()`, `.slice()` or an AI transformation.

Long text uses preserved whitespace and unrestricted wrapping rather than ellipsis.

## Deterministic placeholder

`utils/comicPresentation.js` derives a stable scene/pose from the message identifier. It is deliberately non-AI and contains no provider/billing behavior. Its purpose is to keep the feed visually comic-first before PR-04 adds `TemplateRenderer`.

## Accessibility

The panel uses:

- semantic `article`, `figure` and `figcaption`;
- a separate decorative scene element with `role="img"` and a useful label, so the visible speech text is not hidden inside image semantics;
- `aria-labelledby` for the speaker and `aria-describedby` for visual status;
- polite screen-reader status announcements;
- native keyboard-operable buttons;
- visible `:focus-visible` outlines;
- `prefers-reduced-motion` handling;
- forced-colors borders;
- no text clipping in the speech bubble.

## Automated guard

`npm run ux:pr03` fails CI if the private history returns to ordinary text-only bubbles, if history/composer stop sharing `ComicPanel`, if nonce-based optimistic replacement disappears, if exact-copy starts trimming/truncating, or if the accessibility hooks above are removed.

All PR-02 security and realtime jobs continue to run unchanged.

## Gate to PR-04

PR-04 may introduce `TemplateRenderer` and golden visual tests without changing the PR-03 message identity or accessibility contracts. A renderer must update the same logical message/card and must never rewrite the quoted source text.
