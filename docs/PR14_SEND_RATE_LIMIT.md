# PR-14 — Atomic send rate limit

## Goal

Add a small provider-independent anti-spam primitive for the closed beta without weakening ComicChat's existing idempotency, blocking, RLS, or generation-queue boundaries.

The initial beta policy is **30 new messages per rolling 60 seconds per authenticated sender**.

This is intentionally a product safety default, not a permanent pricing or billing quota. It should be revisited with beta telemetry.

## Server enforcement

The rate limit lives inside `comic_send_message`, the same authenticated RPC used by the web app and MCP.

Authenticated clients still cannot INSERT directly into `comic_message`.

Before a new message is counted/inserted, the function acquires a transaction-scoped PostgreSQL advisory lock derived from the sender UUID. This serializes untrusted send RPCs for one sender, preventing two concurrent requests from both observing the same pre-insert count and overshooting the limit.

A hash collision can only over-serialize unrelated senders; it does not let a sender bypass the limit.

## Idempotency ordering

The critical order is:

1. authenticate and verify conversation membership;
2. determine the PR-11 block state;
3. acquire the per-sender transaction lock;
4. look for the existing `(conversation, sender, client_nonce)` message;
5. return that exact message for a valid retry;
6. reject a changed payload as `client_nonce_conflict`;
7. reject a genuinely new blocked interaction;
8. count recent messages and reject the 31st new send inside the window;
9. insert and enqueue the new message.

Therefore **idempotent retries do not consume additional message quota and still work when the sender is already at the limit**.

Existing retry behavior after a PR-11 block is preserved: the old message is returned but no new generation enqueue is requested while interaction is blocked.

## Error contract

A new send over the threshold raises:

- error: `send_rate_limited`
- hint: `retry_after_seconds=60`

The hint is conservative because the exact remaining delay depends on the oldest message still inside the rolling window.

The web composer keeps the user's exact draft and shows a neutral "try again shortly" message. MCP receives the same server error through the existing send tool.

## Scope and limitations

This PR limits new message creation only. It does not yet add:

- conversation-creation throttling;
- IP/device/network heuristics;
- CAPTCHA;
- provider-generation quotas;
- account-level suspensions;
- adaptive risk scoring.

Trusted administrative/service-role paths remain outside this untrusted-client RPC boundary and require separate operational policy.

## Verification

The PostgreSQL integration creates a fresh two-user conversation, sends exactly 30 new messages from one sender, verifies:

- the exact 30th-message retry still returns the same message;
- the retry does not create a duplicate generation job;
- the 31st new message is rejected;
- a changed payload with the 30th nonce still fails;
- the other sender has an independent quota;
- aging the first sender's messages beyond 60 seconds allows a new send again.

All existing PR-02/05/11/13 security tests, build, OAuth, and Realtime checks remain active.
