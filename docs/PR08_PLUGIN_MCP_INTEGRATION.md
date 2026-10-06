# PR-08 — ComicChat inside ChatGPT: MCP + OAuth foundation

## Decision

ComicChat will expose its existing private Supabase-backed chat domain through an authenticated MCP server. It will **not** create a second message database and it will **not** move authorization decisions into the model.

The MCP server runs as a Supabase Edge Function and receives an RLS-scoped Supabase client only after Supabase Auth validates an OAuth 2.1 access token. This keeps PR-02 membership policies and RPC boundaries authoritative for web and ChatGPT clients alike.

## Why this path

Current OpenAI plugin guidance requires OAuth for customer-specific private data and write actions, with per-tool security metadata. Current Supabase Auth can act as an OAuth 2.1 authorization server for MCP clients, supports PKCE and dynamic client registration, and issues the same user-scoped tokens that existing RLS policies already understand.

The Edge Function uses:

- `withOAuthProtectedResource()` for protected-resource discovery and the OAuth challenge;
- `withSupabase({ auth: 'user' })` for token verification and a user-scoped client;
- `createMcpHandler()` for stateless Streamable HTTP MCP;
- existing ComicChat RPCs/tables for all reads and writes.

## MCP tools

| Tool | Purpose | State |
| --- | --- | --- |
| `comicchat_profile` | Identify the authenticated ComicChat account | read-only |
| `list_conversations` | List direct conversations visible to that account | read-only |
| `get_messages` | Read recent messages in one authorized conversation | read-only |
| `find_users` | Resolve a ComicChat username to a user ID | read-only |
| `open_direct_conversation` | Create or reuse the direct conversation with an exact user ID | idempotent write |
| `send_message` | Send exact text through `comic_send_message` | idempotent write |

`send_message.requestId` maps to the existing `p_client_nonce`, so a retried MCP call cannot silently create a second message when the same UUID is reused.

## Identity and authorization

1. The user remains a normal ComicChat/Supabase user.
2. Supabase Auth OAuth 2.1 is the authorization server.
3. The ChatGPT/MCP client authenticates through authorization-code + PKCE.
4. ComicChat shows `/oauth/consent` and the user explicitly approves or denies the connection.
5. Each MCP request is verified before a tool runs.
6. Tools query through the user-scoped Supabase client; existing RLS/RPC checks decide what that user may access.

No service-role credential belongs in the MCP request path. No OAuth token is written to URL parameters, localStorage by ComicChat code, logs, or a GitHub file.

## Local configuration

`supabase/config.toml` now enables the local OAuth server, dynamic client registration, and `/oauth/consent`. The Edge Function gateway has `verify_jwt = false` **only because** the OAuth middleware must receive and validate the bearer token itself.

The browser dependency is pinned to `@supabase/supabase-js@2.109.0`: it contains the OAuth consent API while preserving the repository's Node 20 baseline.

## Production activation gate

Code in this PR is deployable, but a production ChatGPT connection must not be claimed until all of these are verified on the actual Supabase project:

1. JWT signing uses an asymmetric key supported by the MCP OAuth verifier.
2. Supabase OAuth 2.1 server is enabled.
3. Dynamic client registration is enabled (or an explicit compatible client is registered).
4. Auth Site URL points to the deployed ComicChat frontend and the authorization path is `/oauth/consent`.
5. `comicchat-mcp` is deployed to a stable public HTTPS URL.
6. The unauthenticated MCP handshake returns a correct `WWW-Authenticate` protected-resource challenge.
7. Two different ComicChat accounts connect independently; each sees only its own memberships and messages.
8. `send_message` is confirmed idempotent through a repeated `requestId`.
9. Only after the endpoint is stable do we package/register the private ChatGPT plugin and add Sidebar/Conversation Panel UI on top of the same tools.

## Explicit non-goals

- No ChatGPT-plan image-generation billing is enabled by PR-08.
- No OpenAI API key is added.
- No service-role bypass is added.
- No public/anonymous access to ComicChat messages is added.
- No duplicate ChatGPT-only message store is added.
- No Plugin Extension UI is declared complete before a live MCP connection is tested.

## Verification

Run:

```bash
npm run plugin:pr08
npm run permissions:pr07
npm run portability:pr06
npm run lint
npm run build
```

For MCP/OAuth integration, use a local Supabase stack with Edge Runtime and an MCP client/Inspector, then repeat against the public HTTPS staging endpoint before packaging the plugin.
