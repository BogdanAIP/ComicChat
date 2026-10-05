# PR-02 — Secure private chat domain

Date: 2026-10-05  
Base: `main@3c0c3772ac084bbb0a2b4de5eb08118f77d70cef`

PR-02 creates the first ComicChat private-message path that does **not** reuse the inherited `direct_message*` authorization boundary.

## Scope

The browser private tab now uses:

- `comic_conversation`
- `comic_membership`
- `comic_message`
- `comic_message_receipt`

The legacy `DirectMessages.js`, `direct_message_thread`, `direct_message`, public file upload paths, voice notes, and SMTP notification endpoint remain in the repository only as upstream/legacy code. They are not imported by the ComicChat private tab.

This PR is intentionally text-only. Image generation, character assets, provider billing, and private attachment storage are later gates.

## Authorization model

The authenticated browser has:

- RLS-filtered `SELECT` on conversations, messages, and receipts;
- RLS-filtered `SELECT` only on the caller's own membership rows;
- no direct `INSERT`, `UPDATE`, or `DELETE` on the new ComicChat tables.

Writes happen through narrowly scoped `SECURITY DEFINER` RPCs. Every RPC derives the caller from `auth.uid()`; none accepts a caller user ID as an authorization input. Every definer function fixes `search_path`.

### RPC surface

| RPC | Purpose | Authorization invariant |
| --- | --- | --- |
| `comic_search_users(query)` | Username-only discovery | Requires authenticated caller; returns no email |
| `comic_ensure_direct_conversation(partner_id)` | Create/find a 1:1 conversation | Membership is exactly caller + requested partner |
| `comic_list_direct_conversations()` | Conversation list + last message/unread | Caller identity comes from `auth.uid()` |
| `comic_send_message(conversation, nonce, text)` | Idempotent message insert | Caller must already be a member; sender is always caller |
| `comic_mark_conversation_delivered(conversation)` | Delivery receipt | Updates only caller's receipt rows |
| `comic_mark_conversation_read(conversation)` | Read receipt | Updates only caller's receipt rows |

## Message identity and reconnect behavior

A message has one persistent UUID `id` and one client-generated UUID `client_nonce`.

`comic_send_message` has a unique constraint on `(conversation_id, sender_id, client_nonce)`:

- same nonce + same source text returns the existing message;
- same nonce + different source text raises a conflict;
- concurrent duplicate sends converge on one stored message.

The UI may temporarily render an optimistic `temp-<nonce>` item. When the RPC response or Realtime event arrives, it replaces that optimistic item using the nonce; it does not create a second logical message.

History is sorted by `created_at, id`. The client subscribes to Realtime and then reloads history, deduplicating by persistent ID/client nonce so a reconnect cannot create duplicate cards.

## Realtime and status ownership

`comic_membership` and `comic_message` are added to the Supabase Realtime publication. A participant discovers a newly created conversation from their own membership INSERT (`user_id = auth.uid()`), then reloads the conversation list; other users' membership rows remain invisible. Message Realtime continues to use membership-scoped RLS.

Browser users cannot directly update message status. PR-02 leaves new messages in `queued`; later render-worker PRs will move the same row through `queued -> rendering -> ready | failed` from a trusted server/provider boundary.

Delivery/read data is separate from the message row in `comic_message_receipt`. A participant can only advance their own receipt through RPCs.

## Media and notifications

There is deliberately no file/media URL column in the PR-02 message table. The secure private UI has no upload, audio, Cloudinary, `getPublicUrl`, or email-notification code.

Private assets will be introduced only after a storage design supports participant-authorized access or short-lived signed URLs. SMTP notifications must later derive the recipient from server-side conversation membership, never a caller-supplied email.

## User discovery

The inherited upstream `public.user` table is still broadly readable by legacy/public surfaces. The new ComicChat private UI does not query it directly. `comic_search_users` exposes only user ID + username, requires at least two query characters, excludes the caller, and does not return email.

A future privacy/preferences PR can tighten global profile discoverability without coupling that change to PR-02.

## Verification

CI runs:

1. `npm ci`
2. `npm run lint`
3. `npm run security:pr02`
4. `npm run build`

`scripts/pr02-security-check.mjs` is an architectural guard that fails CI if the new private UI references legacy DM tables, public upload paths, caller-controlled notification fields, or if the migration reintroduces permissive/direct message writes.

`supabase/tests/pr02_security_assertions.sql` is a post-migration database assertion set for a non-production Supabase environment. It checks grants, permissive policies, fixed `search_path`, and the message idempotency constraint.

## Manual two-account acceptance

Against a test Supabase project after applying the migration:

1. Sign in as accounts A and B in separate browser profiles.
2. A searches B by username and opens a direct conversation.
3. B sees the same conversation after refresh/realtime update.
4. A sends text; A and B resolve the same persistent message ID.
5. Retry the same `client_nonce` + text: no duplicate row is created.
6. Retry that nonce with different text: the RPC rejects it.
7. A cannot query a third-party conversation ID through `comic_message`.
8. A cannot directly insert/update/delete `comic_message`.
9. B marking delivered/read changes only B's receipt.
10. Reconnect either client; message history stays deduplicated and ordered.
11. Confirm the private UI exposes no attachment/audio/email action.

## Gate to PR-03

PR-03 may build comic-first visual cards on top of this path only after PR-02 migration + two-account authorization/reconnect acceptance pass in a test Supabase environment.
