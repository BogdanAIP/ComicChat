# PR-09 — Plugin Extension UI foundation

## Purpose

Expose the existing authenticated ComicChat domain as a first-class MCP Apps UI without creating a second backend, a second message store, or a browser-side Supabase credential path.

PR-08 already established the OAuth-protected MCP tools. PR-09 adds one UI resource and one read-only launcher tool on top of those same tools.

## Current OpenAI contract used

The implementation follows the current OpenAI plugin guidance:

- MCP Apps UI resources use `_meta.ui.resourceUri` and `text/html;profile=mcp-app`.
- The component initializes through the MCP Apps JSON-RPC bridge and calls tools through `tools/call`.
- Plugin Extension entrypoints may declare `global` (sidebar/fullscreen) and `thread` surfaces.
- Tool functionality remains usable without UI; the UI is an optional presentation layer.

References:

- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/plugins/build/extensions
- https://developers.openai.com/plugins/reference
- https://developers.openai.com/plugins/build/plugins

## Added surface

`open_comicchat_app` is a read-only launcher tool. It returns:

- the authenticated ComicChat profile;
- the user's direct conversations;
- an optional selected conversation;
- persisted messages for that selected conversation.

The tool is attached to `ui://comicchat/app-v1.html` with global and thread entrypoints.

The UI itself:

- renders the private conversation list and persisted message text;
- opens a conversation through the existing `get_messages` MCP tool;
- sends exact text through the existing idempotent `send_message` tool;
- refreshes the conversation list through `list_conversations`;
- keeps a generated `requestId` stable until a send succeeds, so retrying the same send does not create a duplicate message;
- never receives a Supabase URL/key, OAuth bearer token, service-role credential, OpenAI key, or browser token store.

## Security boundary

Authorization remains server-side:

1. ChatGPT/Codex connects to the PR-08 OAuth-protected MCP endpoint.
2. Supabase Auth validates the caller.
3. Existing RLS and SECURITY DEFINER RPCs authorize each read/write.
4. The iframe can request only registered MCP tools through the host bridge.

The UI does not query Supabase directly and does not contain `localStorage`, `sessionStorage`, cookies, or direct Authorization headers.

## Activation still gated

This PR does **not** claim a live published ChatGPT plugin. Production activation still requires:

1. a stable public HTTPS ComicChat MCP endpoint;
2. production Supabase OAuth 2.1/DCR or compatible client registration;
3. a dedicated UI origin/CSP declaration for submission;
4. two-account isolation/reconnect testing in a real ChatGPT plugin connection;
5. desktop/mobile UI verification;
6. final `plugin.json` / MCP package mapping to the registered production server.

Until those checks pass, the repository should describe this as a deployable Plugin Extension UI foundation rather than a production plugin.

## Verification

```bash
npm run plugin:pr08
npm run extension:pr09
npm run lint
npm run build
```
