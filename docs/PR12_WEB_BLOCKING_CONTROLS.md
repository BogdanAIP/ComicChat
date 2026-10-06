# PR-12 — Web blocking controls

## Goal

Expose the PR-11 database-enforced block/unblock boundary in the primary ComicChat web interface without weakening the existing authorization model.

The database remains authoritative. The browser only calls authenticated RPCs and never writes `comic_user_block` directly.

## Web behavior

- A selected direct conversation shows a **Block** control.
- Blocking asks for explicit confirmation and explains that existing history remains visible.
- After the caller blocks the selected user:
  - the same conversation history remains readable;
  - the composer is disabled for new messages;
  - the button changes to **Unblock**;
  - user-search results are refreshed/cleared so the blocked user is not offered for a new conversation.
- Unblocking calls the dedicated RPC and restores the local composer only when the caller's own block is removed.
- If the *other* user has blocked the caller, the browser cannot enumerate that private block row. A send attempt therefore relies on the server-side `interaction_blocked` rejection and shows a neutral blocked-interaction message.
- A failed send restores the exact original draft text.

## Security boundary

The UI uses only:

- `comic_list_blocked_users`
- `comic_block_user`
- `comic_unblock_user`

The PR-11 PostgreSQL/RLS layer still decides whether search/open/send is allowed. Hiding or disabling browser controls is convenience only, not authorization.

No service-role key, direct block-table mutation, message deletion, provider/billing change, or deployment change is introduced.

## Accessibility

- Block state is exposed through `aria-pressed`.
- Block/unblock remains a real button with keyboard focus styling.
- The blocked-state notice uses `role="status"`.
- The disabled composer has an explanatory placeholder and keeps its draft.
- Mobile layout keeps the safety control separate from connection status.

## Verification

`npm run ux:pr12` statically guards the RPC-only boundary, blocked composer behavior, exact-draft restoration, history preservation, accessibility styles, roadmap row, and CI wiring. Existing build, PostgreSQL, MCP OAuth, and Realtime jobs remain unchanged.
