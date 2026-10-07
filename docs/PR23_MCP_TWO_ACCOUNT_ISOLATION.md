# PR-23 — Authenticated MCP two-account isolation

## Goal

Prove that ComicChat's actual local MCP HTTP transport preserves user identity and private-chat isolation with independent Supabase JWTs.

Earlier gates already verified OAuth protected-resource discovery, malformed-token rejection, database RLS/RPC behavior, and the tool definitions. PR-23 connects those layers end to end.

This remains a local/CI acceptance test. It is not a claim that a production Supabase deployment or ChatGPT plugin has been activated.

## Test topology

The local Supabase stack creates three independent users:

- A — `pr23-alpha`;
- B — `pr23-bravo`;
- C — `pr23-charlie`.

Each user signs in through Supabase Auth and receives a real access token. Every MCP `tools/call` request sends that user's bearer token to the served `comicchat-mcp` Edge Function.

The test uses the same stateless HTTP endpoint and middleware as a real MCP client:

`withOAuthProtectedResource() → withSupabase({ auth: 'user' }) → createMcpHandler()`.

## Acceptance matrix

The test verifies:

1. `comicchat_profile` resolves A, B and C to their own authenticated user IDs.
2. A can discover B by username without receiving B's email.
3. A opens an A↔B direct conversation and sends exact private text.
4. B can list that conversation and read the message through MCP.
5. C cannot enumerate the A↔B conversation in `list_conversations`.
6. C's `get_messages` call for the A↔B ID fails with `conversation_forbidden` and does not leak the private text.
7. C cannot focus the A↔B ID through `open_comicchat_app`.
8. C cannot send a message into A↔B.
9. A's self-service export contains its authorized A↔B data.
10. C's self-service export contains neither the A↔B conversation ID nor private text.
11. Read-only beta safety status remains available independently to both accounts.

## Why raw HTTP is intentional

The deployed Edge Function is stateless. Each request is authenticated independently, so the acceptance test deliberately calls `tools/call` over the actual HTTP/SSE-compatible MCP endpoint instead of bypassing the transport with direct database calls.

The response parser accepts either a JSON body or the legacy stateless SSE `data:` framing supported by `createMcpHandler`.

## Security properties

No service-role credential is sent to the MCP endpoint. The service role is used only by the isolated test harness to create fixture accounts/profiles before those users sign in.

Private tool execution itself uses only each user's Supabase access token.

The test does not print or persist access tokens.

## Non-goals

PR-23 does not:

- deploy a real remote Supabase project;
- register a production ChatGPT plugin;
- automate OAuth consent in a real browser;
- enable a paid generation provider;
- weaken any RLS/RPC boundary;
- claim production readiness.

The remaining production activation gate still requires an explicitly selected real project plus two-user and real ChatGPT UI acceptance there.
