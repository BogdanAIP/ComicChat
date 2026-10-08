# PR-36: Live group chats as comic panels

## Product purpose

ComicChat group conversations behave like ordinary chronological group chats. Every sent text message is immediately represented as a comic image/panel through the existing ComicPanel renderer. No mandatory "scene mode", no automatic chapter splitting, and no independent prompt-to-comic tool. Normal private 1:1 chat and one-permission Stories remain intact.

## Current implemented scope

- Create group with a name and choose closed or public visibility.
- Closed: owner invites by username; invitee explicitly accepts invitation; outsiders cannot join, read members or read/send messages.
- Public: user knows a group ID and explicitly agrees to pre-join rule allowing other group members to compile and publish comics from **future** group messages. Record rule version and time in comic_group_terms_acceptance.
- User can read ordinary single chronological realtime group message stream; existing comic_send_message, comic_read_conversation_messages, RLS and Realtime channels are reused. Each author is labeled.
- View group membership, send message, report another user's message, leave if not owner.
- Restricted/adult-themed group creation is intentionally unavailable until eligibility/age/policy checks. No new content generation provider or paid cost is enabled.

## Planned separately, NOT delivered by PR-36

- Compiling multi-person episodes from selected group chat messages and publication of those stories.
- Separate closed-group and adult-group story visibility enforcement for those future stories.
- Group management: promote/transfer owner, edit group name, discover public group catalog, moderation controls, granular invites/revocation, public story consent upgrade policy.
- Anti-scraping, screenshot/recording limits, watermarks, and other advanced leak defenses, explicitly deferred by user.

## Security requirements

New tables have RLS on and no direct authenticated table grants; group membership, invitations, acceptances and public-group join rules are exposed only via bounded SECURITY DEFINER RPCs with pinned search_path and auth.uid. Existing message-read/send RPCs remain membership guarded. Closed groups use invitations, not URL guesswork. Public-group join must accept a visible publishing rule; no one is silently enrolled.

## Release criteria

PostgreSQL 17 integration for group join/invites, 3-user messages, foreign read/send denial, exit revocation and public join terms; Next.js lint/build; local browser acceptance for old 1:1 flow. Before claiming real multiuser staging group readiness, complete genuine authenticated remote Playwright testing (3 accounts), runtime smoke, responsive view and pending invite acceptance. Staging remote history needs migration reconciliation before automatic db push.

Important: Test fixtures can be seeded in staging without lowering its email confirmation policy, but they should not be mistaken for validated signup-and-email-confirmation flows.
