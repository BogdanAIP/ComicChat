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

## Realtime send probe and receive-only guard

The first live negative probe showed that the Supabase client can return an `ok` transport status from `channel.send({ type: 'broadcast', ... })` for a valid conversation member. That status alone is not treated as proof that another client received the event.

The authoritative test is end-to-end: user A attempts `CLIENT_INJECT` while user B is subscribed to the same private conversation. The test fails only if B actually receives the client-generated event.

Supabase authorizes Broadcast receive and send separately on `realtime.messages`; send authorization is governed by INSERT policies. PR-18 therefore adds an explicit restrictive INSERT policy for the `anon` and `authenticated` client roles with `WITH CHECK (FALSE)` as defense in depth.

Database-triggered `realtime.send()` remains the intended ComicChat event-production path.

## Scope

PR-18 began as test hardening and keeps all successful existing authorization semantics. The only production change is an explicit receive-only Realtime guard motivated by the live send probe. It does not add service-role paths to clients, enable media, or claim production deployment readiness.
