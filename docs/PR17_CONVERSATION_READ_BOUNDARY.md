# PR-17 — Explicit private conversation-read boundary

## Goal

Remove ambiguity from private message reads in ComicChat.

Before this milestone, web and MCP read `comic_message` directly under RLS. RLS correctly hid foreign rows, but an arbitrary foreign or nonexistent conversation UUID could both look like an empty result. The MCP app also echoed the caller-supplied conversation UUID as `selectedConversationId` even if it was not an authorized conversation.

PR-17 introduces one authenticated read RPC:

`comic_read_conversation_messages(conversation_id, limit)`

## Authorization contract

The RPC derives the user from `auth.uid()` and checks current membership before reading messages.

A foreign conversation ID and a nonexistent UUID intentionally produce the same result:

- SQLSTATE `42501`
- error `conversation_forbidden`

This avoids turning the read endpoint into a conversation-existence oracle.

The RPC does not take a user ID and cannot be used to read on behalf of another account.

## Bounded reads

The caller must request between 1 and 1000 messages. The RPC selects the newest bounded window, then returns that window in chronological order so the current comic feed remains stable.

The web client requests up to 1000 recent messages for the selected conversation.

MCP:

- `get_messages` uses the same RPC with its existing maximum of 100;
- `open_comicchat_app` uses the same RPC when a conversation is explicitly focused;
- an unauthorized focus now fails instead of echoing an arbitrary selected conversation ID with an empty message list.

## Existing guarantees preserved

This does not weaken table RLS. Direct `SELECT` remains RLS-filtered as defense in depth.

Deletion-requested users may still read existing history, consistent with PR-16. Blocking also preserves old history, consistent with PR-11.

No media access is introduced; attachments remain disabled until a private signed-media boundary exists.

## Verification

The PostgreSQL test creates A↔B and B↔C conversations and verifies:

- A and B can read A↔B;
- A cannot read B↔C;
- C cannot read A↔B;
- a random nonexistent UUID also fails;
- the foreign and nonexistent failures are byte-for-byte the same SQLSTATE/error contract;
- the result remains chronological;
- read limits above 1000 fail.
