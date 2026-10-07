# PR-20 — Snapshot-scoped bilateral public-sharing consent

## Goal

Model consent before ComicChat has any public publication surface.

Consent is deliberately **not** a permanent conversation-wide switch. Each proposal is bound to a concrete `through_message_id`. Messages created after that cutoff are not part of the consented snapshot.

## Consent workflow

A member of a private direct conversation can propose a snapshot. Creating the proposal records the proposer's consent to that exact snapshot.

The other current member must consent separately. Either member can later revoke their own consent or cancel the request entirely.

The status RPC reports both consent state and `publication_enabled = false`. Even when both members consent, ComicChat still has no publish endpoint.

## Safety invalidation

Active proposals are permanently cancelled when:

- either participant blocks the other;
- either participant requests account deletion;
- conversation membership is removed.

Undoing the safety action does not resurrect an old sharing proposal. A new explicit proposal is required.

Proposal creation and positive consent also fail if an account is deletion-pending or the participants are blocked.

## Snapshot semantics

A request references an existing message in the same conversation using a composite foreign key. The snapshot means the conversation history through that message in the existing chronological ordering. Future messages are outside the request automatically.

## Privacy / authorization

Tables are RLS-enabled and have no browser table grants. All writes derive the current user from `auth.uid()`.

A foreign request UUID and a random nonexistent request UUID return the same `publication_request_forbidden` result to a non-member so the RPC cannot be used as an existence oracle.

## Publication remains disabled

PR-20 does not add:

- a public URL;
- a public feed;
- a publish/share endpoint;
- media storage;
- signed media access;
- external provider calls.

A future publication PR must re-check current membership, safety state, complete consent and the exact snapshot boundary before exposing anything outside the private conversation.
