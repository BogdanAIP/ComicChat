# PR-18 — Negative-security matrix

PR-18 does not add a new product feature. It strengthens the closed-beta security evidence around the boundaries already introduced in PR-02 through PR-17.

## PostgreSQL / RPC anti-oracle matrix

For the same authenticated caller, the test compares a real-but-foreign object with a random nonexistent UUID.

The following operations must not reveal which case exists:

- private conversation read;
- mark read;
- mark delivered;
- send message;
- report message.

Conversation operations return the same `42501:conversation_forbidden` contract for foreign and unknown conversation IDs. Abuse reporting returns the same `42501:report_message_forbidden` for foreign and unknown message IDs.

The test also confirms the data-export and account-state RPCs derive identity from the current authenticated user rather than accepting another user ID.

## Realtime negative matrix

A live local Supabase test verifies that:

- user C cannot subscribe to user B's private `user:<id>` Broadcast topic;
- user C cannot subscribe to A↔B's private conversation topic;
- a random nonexistent conversation topic is rejected;
- an anonymous client cannot subscribe to the private conversation topic;
- a valid member can subscribe;
- an authenticated browser client still cannot inject a private ComicChat Broadcast, because ComicChat Broadcast production remains database-triggered.

## OAuth protected-resource negative checks

The existing MCP OAuth smoke is extended so both no token and a malformed bearer token must fail with HTTP 401 rather than reaching the MCP tool surface. The protected-resource metadata must not contain known secret-key markers.

## Finding and fix: client Broadcast injection

The live Realtime negative test found a real gap: a valid conversation member could call the client `channel.send({ type: 'broadcast', ... })` successfully even though ComicChat intends all conversation Broadcasts to originate from database triggers.

Supabase authorizes Broadcast receive and send separately on `realtime.messages`; send authorization is governed by INSERT policies. To make ComicChat receive-only even if a platform/default permissive INSERT policy exists, PR-18 adds a restrictive INSERT policy for the `anon` and `authenticated` client roles with `WITH CHECK (FALSE)`.

Database-triggered `realtime.send()` remains the allowed event-production path.

## Scope

PR-18 began as test hardening and keeps all successful existing authorization semantics. The only production change is the explicit receive-only Realtime enforcement discovered by the new live negative test. It does not add service-role paths to clients, enable media, or claim production deployment readiness.
