# PR-11 — User blocking boundary

## Goal

Add the first provider-independent closed-beta safety control: one ComicChat user can block another, and that decision is enforced at the database/RPC boundary shared by the web app and MCP.

This PR intentionally does **not** depend on a public Supabase deployment, external image provider, ChatGPT-plan billing, or production plugin registration.

## Semantics

- Blocking is directional: user A may block user B without writing any state owned by B.
- Existing history is preserved. Blocking does not delete prior messages, receipts, generation jobs, or ledger records.
- While either side blocks the other:
  - ComicChat user search hides the pair from one another;
  - a direct conversation cannot be created or reopened through `comic_ensure_direct_conversation`;
  - neither side can send a new message through `comic_send_message`;
  - the send rejection happens before a retry can enqueue a new generation job.
- Unblocking restores interaction unless the other user still has an independent block in place.
- Browser/MCP clients do not receive direct write privileges on the block table. Mutations go only through authenticated SECURITY DEFINER RPCs with a fixed `search_path`.
- A blocked user cannot read another user's block rows through RLS. Users can list only blocks they created themselves.

## Database surface

New table:

- `comic_user_block(blocker_id, blocked_id, created_at)`

New RPCs:

- `comic_block_user(p_user_id)`
- `comic_unblock_user(p_user_id)`
- `comic_list_blocked_users()`

Updated RPCs:

- `comic_search_users`
- `comic_ensure_direct_conversation`
- `comic_send_message`

The PR-05 transactional generation enqueue remains intact.

## MCP surface

New authenticated tools use the same RPC boundary:

- `list_blocked_users`
- `block_user`
- `unblock_user`

The MCP layer does not bypass RLS or use the service-role key.

## Verification

CI applies PR-02, PR-05, then PR-11 migrations and runs a dedicated two-user blocking test that verifies:

1. block creation is visible only to the blocker;
2. direct table writes are unavailable to `authenticated`;
3. both directions disappear from ComicChat search;
4. both sides are prevented from sending while the block exists;
5. old messages remain readable to their original conversation members;
6. unblocking restores message sending;
7. self-blocking fails closed.

This is the first Stage 8 safety slice. Report/abuse workflows, account deletion/export, quotas, and production two-account acceptance remain separate follow-up work.
