# PR-16 — Account deletion-request boundary

## Goal

Introduce a safe, reversible account-deletion request state without destroying shared ComicChat history.

ComicChat cannot safely expose a one-click hard delete yet because the current domain contains shared conversation rows, sender-attributed usage records, and moderation records. Earlier foreign keys were created with cascade behavior from `auth.users`, so deleting an auth identity directly could erase data that another conversation participant still expects to see.

PR-16 therefore makes deletion a **two-phase process**.

## Phase implemented here: deletion request / read-only tombstone

An authenticated user can request account deletion with `comic_request_account_deletion()`.

While the request is active:

- existing private conversation history remains readable;
- the user can still export their own ComicChat data;
- exact idempotent retries of already-created messages still return the same message;
- the user cannot search for users, open/reopen conversations, or send new messages;
- other users cannot discover the deletion-requested account through ComicChat search;
- other users cannot open/reopen a direct conversation with the account or send it a new message;
- the request can be cancelled, restoring interaction.

This state is intentionally reversible because irreversible purge/anonymization is not implemented in this PR.

## Hard-delete guard

PR-16 adds `ON DELETE RESTRICT` defense-in-depth foreign keys around shared/audit identity references, including memberships, message authorship, usage ledger and abuse-report identities.

The deletion-request row itself also references `auth.users` with `ON DELETE RESTRICT`.

Therefore an administrative/raw deletion of an auth user cannot silently cascade away shared history while ComicChat still has retained records.

This is a guard, not a complete purge implementation.

## Interaction semantics

The database remains authoritative. Web and MCP UI disabling is only convenience.

The existing RPC boundaries are overridden so that:

- `comic_search_users` fails for a deletion-requested caller and hides deletion-requested candidates;
- `comic_ensure_direct_conversation` rejects either a deletion-requested caller or partner;
- `comic_send_message` preserves PR-14 locking, rate limiting and nonce semantics;
- exact retry of an old message still returns the same message, but does not re-enqueue generation while either account is deletion-requested;
- a genuinely new send fails with `account_deletion_pending` for the caller or `account_unavailable` for the partner.

## User surfaces

The web UI exposes:

- **Request account deletion** with a confirmation explaining that shared history is retained;
- a read-only deletion-pending notice;
- **Cancel deletion request**;
- the existing **Export my data** action remains available.

The authenticated MCP server exposes three tools:

- `get_account_deletion_status`;
- `request_account_deletion`;
- `cancel_account_deletion`.

The request tool is destructive-labelled and explicitly requires an affirmative user request.

## What is not implemented yet

PR-16 does not:

- delete the Supabase Auth identity;
- erase or anonymize profile fields;
- purge messages from another participant's history;
- delete moderation/audit data;
- run a retention timer or background purge job;
- claim GDPR/CCPA/legal-compliance completeness.

A later milestone must define the final retention/anonymization policy, ownership of shared messages, moderation retention, and a privileged purge transaction before hard deletion is enabled.
