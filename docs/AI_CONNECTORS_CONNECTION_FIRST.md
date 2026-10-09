# ComicChat — подключаемые AI и ChatGPT/Codex: connection-first (9 October 2026)

## Authoritative priority
**First implement account connections, then investigate what those authenticated accounts are permitted to do.**
Do not substitute an entitlement survey for connecting users. Conversely, an identity connection NEVER implies personal-plan image generation, ChatGPT internal image tool access or API billing permission.

## Implemented in this branch
- `utils/aiConnectorRegistry.mjs`: seven connection types with explicit transport, capability and billing boundaries. Unknown/unimplemented adapters fail closed, and no paid fallback runs implicitly.
- `pages/ai-connections.js`: authenticated Connect/Disconnect page linked from Profile.
- `pages/api/ai/connections.js`: authenticated status/start/unlink, using caller's verified Supabase JWT; no direct browser access to private connection tables.
- `pages/api/ai/callback.js`: single-use state callback, PKCE S256, OAuth code exchange, trusted HTTPS UserInfo identity lookup, refuses silent account swapping. It stores only issuer-provided subject, not access, refresh or ID tokens. Local unlink does not revoke nonexistent stored provider tokens.
- `supabase/migrations/20261009090000_ai_connection_identity_pkce.sql`: service-only one-time flows and linked identities; no browser policies/grants.
- The existing `comicchat-mcp` exposes a read-only list of supported connectors; MCP App UI shows capability readiness and code-drawn comic panels. No image-generation access is inferred from being hosted in ChatGPT.
- CI runs `npm run ai:connectors && npm run ai:oauth`.

## Activate an account connection
A real ChatGPT/Codex OAuth account connection needs a separately **approved** client registration and provider-owned documented HTTPS endpoints. Until configured, Connect is disabled and no login attempt is forged. Configure in the **Next.js server** (never NEXT_PUBLIC):

```text
COMICCHAT_PUBLIC_ORIGIN=https://<your-ComicChat-host>/
SUPABASE_SERVICE_ROLE_KEY=<server-only key>
COMICCHAT_CHATGPT_OAUTH_CLIENT_ID=<approved OAuth client ID>
COMICCHAT_CHATGPT_OAUTH_AUTHORIZATION_URL=<approved HTTPS authorize endpoint>
COMICCHAT_CHATGPT_OAUTH_TOKEN_URL=<approved HTTPS token endpoint>
COMICCHAT_CHATGPT_OAUTH_USERINFO_URL=<approved HTTPS userinfo endpoint>
COMICCHAT_CHATGPT_OAUTH_CLIENT_SECRET=<optional confidential-client secret>
```

Use the analogous `COMICCHAT_CODEX_...` variables for a separately approved Codex issuer/client. Configure the provider redirect allowlist to exactly `https://<your-ComicChat-host>/api/ai/callback`. The default requested scopes are **openid profile** only. This is an identity link, not an authorization to run images; don't silently extend scopes.

Apply the new SQL migration to staging *only after* reviewing migration history and CI. Do not run a naive full `supabase db push` over the known diverged staging history. Do not deploy provider secrets or enable paid generation in this PR.

## What is NOT implemented
- No real ChatGPT-plan or Codex image generation through a subscription; no claimed image-capable OAuth scope.
- No configured approved ChatGPT/Codex OAuth clients yet, so end-to-end account sign-in is **not verified**.
- No ComfyUI/MCP external image executor; metadata is future-facing and correctly marked `implemented:false`.
- No full Groups/Stories React parity in embedded ChatGPT MCP App yet; this first pass has a comic look and AI connection catalog.
- Identity-only links discard OAuth tokens intentionally. Any future plan-capability execution requires distinct permission, secure token lifecycle, revocation, terms, and verified host support.

## Next implementation sequence
1. Validate secret-free account connections locally using a controlled OAuth fixture, including two ComicChat accounts, one-use callback, deny/replay, unlink, and provider identity collision.
2. Establish approved ChatGPT/Codex OAuth clients and exercise the above flow before undertaking plan-capability investigation.
3. Extract shared comic UI for ChatGPT plugin and web with Groups/Stories/Style screens using existing secured RPCs. Avoid a second message store or an unsafe browser-token workaround.
4. Implement real image provider adapters and code SVG; separate model execution authority from identity and cost.
5. **Only after connections work**, investigate each official ChatGPT/Codex plan scope, image tool entitlement, transfer of host-produced assets, and billing legality. Update capabilities from verified evidence, not assumption.

## Security
No credentials in localStorage, sessionStorage, URLs, client bundled code or logs. No external API cost, changes to `external_generation_enabled`, or publication permissions. ComicChat remains independent of Rakazo at runtime.
