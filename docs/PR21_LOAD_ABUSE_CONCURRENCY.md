# PR-21 — Deterministic load / abuse concurrency harness

## Goal

Exercise the existing closed-beta send boundary under real PostgreSQL concurrency without changing the product quota or enabling a new provider.

This is a correctness/stress test, not a throughput benchmark. It intentionally avoids flaky wall-clock performance thresholds.

## Burst quota test

Two authenticated members send concurrently in the same direct conversation:

- sender A submits 40 unique messages into the same rolling minute;
- sender B submits 8 unique messages at the same time.

Expected result:

- exactly 30 A messages succeed;
- exactly 10 A requests fail with `send_rate_limited`;
- all 8 B messages succeed independently;
- accepted messages have exactly one generation job and one initial `queued` ledger record.

This verifies that the PR-14 advisory lock is sender-scoped and that concurrency cannot race one sender past the 30-message limit.

## Idempotent retry fan-out

Twenty concurrent requests use the same sender, conversation, nonce and source text.

All calls must converge on one logical `message_id`, one `comic_generation_job`, and one initial queued usage-ledger row.

## Conflicting nonce race

Two concurrent requests use the same fresh nonce but different source text.

Exactly one may create the message. The other must fail with `client_nonce_conflict`. There must still be only one generation job.

## Scope

PR-21 does not:

- raise or lower the 30 messages / 60 seconds policy;
- add a new mutable quota counter;
- add Redis or external infrastructure;
- enable a paid image provider;
- claim a production capacity number.

The purpose is to convert existing concurrency assumptions into a repeatable CI acceptance test before closed beta.
