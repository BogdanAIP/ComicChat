# PR-15 — Self-service ComicChat data export

## Goal

Give an authenticated ComicChat user a locally testable, provider-independent way to export their ComicChat data before closed beta.

This is a **read-only privacy feature**. It does not delete data, change membership, publish a conversation, or create cloud resources.

## Trust boundary

The export is assembled by `comic_export_my_data()` at the PostgreSQL/RPC boundary and derives the caller from `auth.uid()`.

The caller cannot supply another user ID.

The export contains:

- the caller's ComicChat profile;
- the caller's own membership rows;
- participant IDs/usernames for conversations the caller currently belongs to;
- conversation metadata and message history only for conversations where the caller is a member;
- only the caller's delivery/read receipt rows;
- blocks created by the caller;
- abuse reports submitted by the caller;
- generation jobs attributed to the caller as sender;
- usage-ledger events attributed to the caller.

## Deliberate omissions

The export does **not** include:

- Supabase Auth/OAuth tokens, provider credentials, cookies, session metadata, or service-role secrets;
- generation-worker `lease_token` values;
- reports submitted by other users;
- blocks created by other users;
- generation jobs or usage-ledger rows charged to another sender;
- conversations or messages the caller does not belong to;
- internal direct-conversation `direct_key` values.

## User surfaces

The web ComicChat sidebar exposes **Export my data**, which downloads the RPC result as a JSON file without sending it to a third-party service.

The authenticated MCP boundary exposes `export_my_data` as a read-only tool. Its description explicitly limits use to a user's request to export or inspect their own ComicChat data because the result can contain private conversation history.

## Verification

The PostgreSQL integration test creates three users and two separate conversations:

- A ↔ B is visible to A;
- B ↔ C is not visible to A.

It verifies that A's export contains the A ↔ B history, A-owned safety/billing records, and omits the unrelated B ↔ C message, B's generation job, and internal worker lease-token fields.

Deletion semantics remain a separate milestone because deletion changes other participants' shared history and needs an explicit product policy.
