# PR-23 — Authenticated MCP two-account isolation

## Goal

Prove that ComicChat's actual local MCP HTTP transport preserves user identity and private-chat isolation with independent Supabase JWTs.

Earlier gates already verified OAuth protected-resource discovery, malformed-token rejection, database RLS/RPC behavior, and tool definitions. PR-23 connects those layers end to end.

This remains a local/CI acceptance test. It is not a claim that a production Supabase deployment or ChatGPT plugin has been activated.

## Test topology

The isolated local Supabase stack creates three ordinary users:

- A — `pr23-alpha`;
- B — `pr23-bravo`;
- C — `pr23-charlie`.

Each account is created through the normal local signup endpoint, receives its own profile row, then signs in through Supabase Auth. Every MCP `tools/call` request sends only that user's access token to the served `comicchat-mcp` Edge Function.

The test exercises the same transport chain as an MCP client:

`withOAuthProtectedResource() → withSupabase({ auth: 'user' }) → createMcpHandler()`.

## Acceptance matrix

The test verifies:

1. `comicchat_profile` resolves A, B and C to their own authenticated user IDs.
2. A can discover B by username without receiving B's email.
3. A opens an A↔B direct conversation and sends exact private text.
4. B can list that conversation and read the message through MCP.
5. C cannot enumerate the A↔B conversation in `list_conversations`.
6. C's `get_messages` call for the A↔B ID fails with `conversation_forbidden` and does not leak private text.
7. C cannot focus the A↔B ID through `open_comicchat_app`.
8. C cannot send a message into A↔B.
9. A's self-service export contains its authorized A↔B data.
10. C's self-service export contains neither the A↔B conversation ID nor its private text.
11. Read-only beta safety status remains independently available to A and C.

## Why raw HTTP is intentional

The Edge Function is stateless. Each request is authenticated independently, so this acceptance test calls `tools/call` over the actual HTTP/SSE-compatible MCP endpoint instead of bypassing the transport with direct RPCs.

The parser accepts either a JSON response body or stateless SSE `data:` framing.

## Fixture privilege boundary

No database-admin credential is sent to the MCP endpoint.

The test runner uses its isolated local PostgreSQL connection only to insert the legacy profile fixture after ordinary Supabase signup. MCP tool execution itself receives only the corresponding user access token.

Passwords and access tokens are generated/held in memory during the job and are not logged or committed.

## Non-goals

PR-23 does not:

- deploy a real remote Supabase project;
- register a production ChatGPT plugin;
- automate a real browser OAuth consent screen;
- enable a paid generation provider;
- weaken an RLS/RPC boundary;
- claim production readiness.

Production activation still requires an explicitly selected real project plus independent-user and real ChatGPT UI acceptance there.
