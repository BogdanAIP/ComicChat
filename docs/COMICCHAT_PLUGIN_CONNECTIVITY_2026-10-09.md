# ComicChat plugin not opening — verified staging diagnosis (2026-10-09)

## Actual observation
The private ChatGPT package `comicchat` v0.1.0 is stored under plugin ID `plugins_6ac8acc335288191840771be191ab9fb` with a correct-looking portable `mcp.json` for the existing HTTPS Supabase MCP server. Showing `@ComicChat` in the composer **does not** prove that its app is installed, authenticated or hydrated with tools.

On the same current ChatGPT account, one plugin-management check returned `not_installed`, while a separate suggestion path returned `already_installed`. Treat this as inconsistent host-level installation information; do not claim either is definitive. A real authenticated MCP `tools/list` from the ChatGPT host has not yet succeeded.

## Independent remote tests using Rakazo R
Run `npm run mcp:remote-readiness` from the repo, or `node scripts/comicchat-mcp-remote-readiness.mjs`.

Verified:
- MCP initial POST: HTTP 401 with standards-based `WWW-Authenticate: Bearer resource_metadata=...` (expected for an unauthenticated private app).
- GET `.../comicchat-mcp/oauth-protected-resource`: HTTP 200 with resource + `authorization_servers`.
- Issuer: `https://qbqfxuijnispicvazmgj.supabase.co/auth/v1`.
- GET `https://qbqfxuijnispicvazmgj.supabase.co/.well-known/oauth-authorization-server/auth/v1`: **HTTP 404**, fails authorization-server discovery.
- GET `https://qbqfxuijnispicvazmgj.supabase.co/auth/v1/oauth/authorize` (including syntactically valid parameters with a deliberately invalid client): **HTTP 404**.
- GET `.../auth/v1/.well-known/openid-configuration`: HTTP 200; OIDC metadata existing alone does not prove the OAuth authorization route is enabled.
- GET `https://comicchat-staging.vercel.app/oauth/consent`: HTTP 200.
- GET `.../auth/v1/.well-known/jwks.json`: HTTP 200, asymmetric ES256 public JWK available.

This strongly indicates the hosted project's Supabase Auth **OAuth 2.1 Server is not currently enabled/configured for MCP clients**. Confirm exact switch state in project dashboard before making claims about its settings.

## Operational unblock (authorized project administrator)
1. Sign into the account with access to the **existing comicchat-staging Supabase project** (ref `qbqfxuijnispicvazmgj`). The currently available Rakazo dedicated Playwright Supabase browser account received **'You do not have access to this project'**, so the assistant could not change Auth settings there. The connected Supabase MCP tool does not expose a method for changing Auth OAuth configuration; database SQL is not a substitute.
2. Navigate **Authentication → OAuth Server**. Enable **OAuth 2.1 Server**. Configure **Authorization Path: `/oauth/consent`** and enable **Dynamic Client Registration** if the ChatGPT client relies on automatic registration.
3. In **Authentication → URL Configuration**, set the site's correct HTTPS origin to `https://comicchat-staging.vercel.app`. Ensure allowed redirects/consent path are correct. Do not expose service role keys, tokens or ChatGPT browser cookies.
4. Verify the discovery URL above now returns HTTP 200 JSON, and that `/auth/v1/oauth/authorize` no longer returns HTTP 404 to an invalid-client request. Run `npm run mcp:remote-readiness` until 5/5 PASS.
5. In ChatGPT's **Plugins → Personal / Installed**, open the existing ComicChat package, confirm it is actually installed in the active account/workspace, and complete its **Connect** flow to ComicChat. If host-level status remains contradictory, reconnect/reinstall through supported UI and retest in a *new* chat; avoid creating a duplicate plugin.
6. Test `open_comicchat_app`, `list_conversations`, `get_messages` and `send_message` with two separately authorized test accounts. Verify owner-only access and iframe rendering. An `@ComicChat` name without a tool invocation is not a pass.

## Additional rollout discrepancy
Vercel alias `comicchat-staging.vercel.app` was still on PR #38 commit `7bd8741`, while the repository had merged PR #39 `b22da9d` and PR #40 was a draft. Supabase Edge `comicchat-mcp` version 1 lacks PR #40 tools. Update deployments only after passing CI and reviewing appropriate migrations; do **not** automatically replay the remote's divergent migration history.

## Boundary
This OAuth connection is ChatGPT **as an MCP client of ComicChat**. It is distinct from linking a personal ChatGPT/Codex account **into ComicChat**, and neither one grants ChatGPT-plan image-generation entitlements. Paid external art generation must remain off.
