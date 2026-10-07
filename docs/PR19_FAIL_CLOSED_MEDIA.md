# PR-19 — Fail-closed media boundary

## Goal

Make the current absence of a real media provider an explicit security property instead of an implicit assumption.

ComicChat still has no enabled private object storage, signed-URL service, browser upload path, or public image publication endpoint. PR-19 does not add any of those features.

## Generation descriptor rule

The trusted worker can persist deterministic generation metadata in `comic_generation_job.output_descriptor`. That descriptor is readable by the sender and is included in the self-service export.

PR-19 adds a database trigger that rejects media locators while the media provider is disabled. The following JSON key names are rejected recursively because the guard evaluates the complete JSON representation:

- `url`, `uri`;
- `public_url`, `signed_url`, `download_url`;
- `object_key`, `storage_key`;
- `bucket`, `storage_bucket`.

Descriptors are also capped at 64 KiB.

This prevents a future worker change from silently turning a user-visible descriptor into an unreviewed public URL or storage-key delivery channel.

## Capability contract

Authenticated clients can call `comic_get_media_capabilities()`.

For PR-19 it reports:

- client upload: disabled;
- private asset storage: disabled;
- signed asset access: disabled;
- public asset URLs: disabled;
- active media provider: none.

The MCP server exposes the same state through a read-only `get_media_capabilities` tool so ChatGPT clients do not infer attachment/image-storage support that is not actually enabled.

## Existing rendering

TemplateRenderer and MockProvider continue to work because their output is deterministic metadata without media locators. No source text is moved into generated art and no billing behavior changes.

## Non-goals

PR-19 does not create a storage bucket, upload endpoint, signed URL, public feed, publication action, or external image provider. Public sharing consent is a separate milestone because consent must be modeled before any publication surface exists.
