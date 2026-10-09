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

## 2026-10-09 follow-up: ChatGPT shows connected but cannot see tools

Verified with Rakazo R dedicated authenticated Supabase Playwright after the project transfer to AIPMemoryHub's Project:

- Supabase OAuth Server **enabled**. Site URL is **https://comicchat-staging.vercel.app**; authorization path is **/oauth/consent**; dynamic client registration enabled.
- Live read-only remote readiness: **5/5 PASS**. Protected-resource metadata, authorization-server discovery and authorization route all respond properly.
- GitHub main \`supabase/functions/comicchat-mcp/index.ts\` registers **21 tools**, including \`open_comicchat_app\`, \`list_conversations\`, \`get_messages\`, and \`send_message\`.
- Supabase Dashboard → Edge Functions → \`comicchat-mcp\`: function deployed, code present, only deployment v1.
- Supabase Dashboard → Edge Functions → \`comicchat-mcp\` → Invocations → Last 24 hours: **7 HTTP 401 results**, no verified authenticated invocation. 401 is expected for anonymous diagnostic requests and cannot alone prove a client error.
- Supabase Dashboard → Authentication → OAuth Apps: **"No OAuth apps found"**. ChatGPT has not demonstrably registered as a client in this Supabase project, even though the user reports seeing \`@ComicChat\` as connected in the ChatGPT UI.
- Plugin Creator private package \`plugins_6ac8acc335288191840771be191ab9fb\` v0.1.0 has a valid \`mcp.json\` URL for this exact project. Plugin Management reported \`not_installed\` for ComicChat in this conversation. As a control it also reported \`not_installed\` for private MyHOT, so this permission status is not conclusive on its own.
- Earlier chat invocation referred to \`plugin://comicchat@created-by-me-remote\`; must verify it maps to the same private plugin ID, not assume a display-name match.

**Next required step (ChatGPT host UI, explicit user approval):** open the specific private ComicChat plugin detail, complete its install/Connect OAuth authorization (or supported reconnect if ChatGPT says "connected" but the OAuth Apps table stays empty), consent at the hosted ComicChat site, then check that OAuth Apps now contains a ChatGPT client. Only after that should an authorized \`initialize → tools/list\` be exercised and \`open_comicchat_app\` invoked. Never copy tokens from a user's browser into a chat or bypass OAuth approval. Do not redeploy or disable auth just to make the icon appear; it would not resolve client registration.


## 2026-10-09 23:58 OpenCLI: traced ChatGPT web-side installation

The user requested direct inspection through Rakazo **OpenCLI** rather than more instructions to open screenshots.

**Evidence observed using R \`computer/browser\` with \`mode: opencli\` in the logged-in ChatGPT web account:**
1. Navigated to \`https://chatgpt.com/plugins/plugins_6ac8acc335288191840771be191ab9fb\`. Title **"ComicChat | Плагины ChatGPT"**. Plugin page shows "Ваш облачный плагин", \`ComicChat\`, author \`Tura\`, version \`0.1.0\`, one **MCP Server: Comicchat**. The visible primary link is **"Открыть в приложении для компьютера"** with actual destination \`/codex/open-app?target=plugin&plugin_id=plugins_6ac8acc335288191840771be191ab9fb\`. NO \`Install\` or \`Connect\` button on this page. Clicking Open in desktop navigated to a desktop launcher, not to OAuth. This corroborates the separate tool result \`not_installed\` in the current ChatGPT web conversation.
2. Navigated to the full ChatGPT \`/plugins\` directory via OpenCLI. The page has **Add (+)** and **Personal** sections, and a separate settings link \`/settings/plugins-settings\`. This is the correct entry point for **Add custom MCP server**. A subsequent R browser interaction timed out; then Rakazo connector returned \`McpServerError: Session terminated\`. Thus creating the registered MCP app could not be completed during this run.
3. Official developer docs (2026) specify the browser-compatible path, not merely a raw portable MCP package:
   - \`https://developers.openai.com/api/docs/guides/custom-mcp-server\`: ChatGPT Plugins → **Add (+) → Add custom MCP server** → name, URL \`https://qbqfxuijnispicvazmgj.supabase.co/functions/v1/comicchat-mcp\` → authentication **OAuth** (Supabase supports OAuth2.1+DCR, S256 PKCE) → approve risk disclosure → **Create as a plugin** → install from Personal. Scan tool list, enable tools, and run OAuth **Connect**.
   - \`https://developers.openai.com/plugins/build/plugins\`: For an existing custom plugin to refer to an **already registered ChatGPT MCP app**, create \`.app.json\` with \`{"apps":{"comicchat":{"id":"<actual registered plugin_asdk_app...>","required":true}}}\` following the exact registered app ID, and set \`extensions.com.openai.apps\` to \`./.app.json\` in \`plugin.json\`. **Do not fabricate an app ID.** If the host requires the \`asdk_app_\` form, use the canonical ID from the newly created MCP app configuration. Bump plugin version when updating.
   - Portable root \`mcp.json\` is accepted as a package component but **does not prove that a separate ChatGPT web account has installed/authorized/discovered its server tools**. The ChatGPT plugin detail instead indicated desktop launcher, not a working web connection.

**Conclusive diagnosis:** \`list_conversations\`, \`get_messages\` etc exist in \`supabase/functions/comicchat-mcp/index.ts\` and server responds to OAuth metadata, but the **ChatGPT web host has not established a registered + installed + OAuth-authorized MCP application session for this private plugin**. Merely displaying \`@ComicChat\` and its plugin card is not an authorized \`tools/list\` test.

**Remaining execution (not done, NOT user verification request):** once R OpenCLI reconnects, open ChatGPT Plugins via the same **OpenCLI browser**, Add custom MCP server, select OAuth/DCR, create registered plugin app and record generated ID, consent from the browser, check Supabase OAuth Apps for registered client and authenticated invocations, inspect tool scan for \`open_comicchat_app\` and \`list_conversations\`, test genuine call. Then, if retaining the existing private package, update the **same** package to reference this app via \`.app.json\`; avoid duplicate lookalike ComicChat icons and do not disable authentication. Do not claim successful integration before these checks.
