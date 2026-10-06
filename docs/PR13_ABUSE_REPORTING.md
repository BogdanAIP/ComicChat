# PR-13 — Private abuse reporting

## Goal

Add a closed-beta complaint path for one exact incoming ComicChat message without exposing the reporter to the reported user or trusting browser/MCP authorization.

This is a reporting ledger and safety intake boundary. It does not automatically punish, hide, delete, suspend, or otherwise adjudicate the reported user.

## Database boundary

New table:

- `comic_abuse_report`

Each report records:

- reporter user;
- reported message sender;
- conversation and message identity;
- stable client request UUID;
- reason and optional details;
- review status;
- timestamps.

Authenticated clients receive only reporter-scoped SELECT access. Direct INSERT/UPDATE/DELETE is not granted.

New RPCs:

- `comic_report_message(message_id, client_nonce, reason, details)`
- `comic_list_my_reports()`

`comic_report_message` verifies that the caller is a current member of the target message's private conversation and rejects reports of the caller's own message. A random or leaked message UUID from another private conversation therefore cannot be used as an IDOR reporting oracle.

## Idempotency and anti-spam

A report request UUID is stable across retry. Reusing the same UUID with changed content fails with `report_nonce_conflict`.

A reporter can create only one report for a given message. A second request UUID for the same message returns the existing report instead of creating duplicate moderation work.

Details are normalized and capped at 1000 characters.

## Reporter privacy

The reported user cannot enumerate reports about themselves through the normal authenticated ComicChat surface. The RLS policy and `comic_list_my_reports` expose only reports created by the caller.

This PR does not define moderator/admin access, retention SLA, escalation policy, or enforcement actions. Those require an explicit trusted moderation surface and operational policy.

## Web UX

Incoming persisted comic panels expose a **Report** action. The report form:

- requires a reason;
- allows optional details up to 1000 characters;
- keeps a stable request UUID if submission fails and the user retries;
- never appears on the caller's own messages or draft preview;
- confirms submission without revealing the report to the other participant.

## MCP surface

The authenticated MCP exposes:

- `report_message` — an explicit high-impact action for a specific message;
- `list_my_reports` — read-only visibility into the caller's own reports.

The MCP function uses the same RPCs as the web app and does not use a service-role bypass.

## Verification

CI applies PR-02, PR-05, PR-11, and PR-13 migrations and verifies:

1. reporter-only visibility;
2. reported-user non-visibility;
3. non-member IDOR rejection;
4. self-report rejection;
5. request UUID idempotency and conflict behavior;
6. one-report-per-message deduplication;
7. invalid reason and oversized details rejection;
8. direct authenticated INSERT denial.

The existing build, blocking, OAuth, and Realtime checks remain active.
