# PR-22 — Closed-beta safety disclosure and incident response

## Purpose

PR-22 makes the **current reviewed ComicChat safety facts** available to authenticated users and maintainers. It does not create a new provider, deletion mechanism, media system, publication surface, or legal policy.

The application is still a closed-beta implementation.

## Current user-facing facts

The authenticated `comic_get_beta_safety_status()` boundary reports:

- generation provider: `mock`;
- external generation provider: **disabled**;
- private media storage: **disabled**;
- public publication: **disabled**;
- hard account deletion: **disabled**;
- automated retention purge: **disabled**;
- retention duration: **not defined**;
- self-service data export: enabled;
- reversible deletion request: enabled;
- abuse reporting: enabled;
- blocking: enabled;
- new-message quota: 30 messages per rolling 60 seconds per sender;
- incident-response runbook: available.

These fields are product-state disclosure, not configuration knobs.

## Data handling facts

ComicChat currently persists data needed for the implemented private-chat model, including:

- local ComicChat profile data;
- conversation membership and conversation metadata;
- exact original message text and message status;
- delivery/read receipts;
- blocks and reporter-owned abuse reports;
- sender-attributed generation jobs and usage ledger records;
- reversible account-deletion request state;
- public-sharing consent requests, although publication itself remains disabled.

### Retention

**No retention duration is configured or claimed.**

There is no automatic retention purge. A deletion request currently changes the account to a reversible read-only state; it is not hard deletion. Shared history and audit-linked records are deliberately protected from accidental auth-user cascade deletion.

A future retention/anonymization/purge policy requires a separate reviewed design. This PR does not invent a number of days, months, or years and does not claim GDPR, CCPA, or other legal-compliance completeness.

## External provider notice

The only enabled generation provider is the deterministic `mock` provider. No external image-generation provider is enabled, and no ChatGPT-plan image billing is claimed.

Private object storage, signed media access, public asset URLs, and publication endpoints remain disabled.

Before any real external generation provider can be enabled, a later reviewed change must update:

1. provider and billing-source permission gates;
2. sender attribution / ledger behavior;
3. user-facing provider notice;
4. relevant data-flow and retention documentation;
5. two-account integration tests.

## Known limitations

The closed beta currently has these explicit limitations:

- no hard account deletion;
- no automated retention purge and no defined retention duration;
- no real image-generation provider;
- no private asset/media storage;
- no public publication endpoint, even after both users consent to a snapshot;
- no claim of production deployment readiness;
- no claim that ChatGPT subscription resources can fund generation;
- current security/load evidence is CI/local-Supabase based, not a production-capacity certification.

## Incident response runbook

This runbook describes safe operational steps; it does not authorize destructive actions automatically.

### 1. Triage

- identify the affected boundary: auth/OAuth, RLS/RPC, Realtime, message integrity, generation/billing attribution, media, or publication consent;
- record the failing request/test, commit SHA, environment and time;
- avoid copying access tokens, service-role keys, message contents, or private screenshots into public issues/logs.

### 2. Contain fail-closed

Prefer disabling the affected capability or endpoint over weakening authorization.

Examples:

- keep media/publication/provider features disabled if their boundary is uncertain;
- stop an affected deployment or MCP endpoint if authentication cannot be trusted;
- do not bypass RLS with a browser/service-role workaround;
- do not hard-delete shared records as an incident shortcut.

### 3. Preserve evidence

- preserve relevant CI logs, database error codes and audited identifiers;
- preserve sender-attributed usage-ledger records;
- do not rewrite or delete moderation/audit evidence merely to make tests pass;
- rotate compromised credentials through the owning platform, never by committing replacements to Git.

### 4. Scope and reproduce

Use isolated test accounts to determine whether the issue crosses:

- users;
- conversations;
- senders/billing sources;
- Realtime topics;
- OAuth identities;
- media/publication boundaries.

Add a deterministic regression test before reopening the affected capability.

### 5. Recover

- merge the minimal reviewed fix;
- require the established CI security suites to pass;
- re-test with independent users where the issue is identity-scoped;
- restore a disabled capability only after its authorization and data-flow boundaries are verified.

### 6. Communication

Any user or regulatory notification depends on the actual incident, deployment jurisdiction, contractual obligations and applicable law. This repository does **not** hard-code a universal notification deadline or claim legal compliance.

## Non-goals

PR-22 does not:

- choose a retention duration;
- implement purge/anonymization;
- enable hard deletion;
- enable an external provider;
- enable storage/media URLs;
- enable publication;
- create production infrastructure;
- make a legal-compliance certification.
