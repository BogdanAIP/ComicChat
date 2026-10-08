# PR-35 — One permission for a 1:1 comic

A participant chooses a message cutoff and sends the other participant ONE permission request covering both making and publishing the resulting comic. One approval permits both actions; no second request. Refusal blocks both. Live chat messages continue unaffected.

Reuses the existing PR-20 permission RPCs: comic_propose_public_snapshot, comic_set_public_snapshot_consent, comic_cancel_public_snapshot_request, comic_list_public_snapshot_requests. PR-20 cancels permissions on blocks, account deletion and membership changes.

New PR-35 SQL provides comic_release_approved_episode and comic_list_released_episodes. Only the initiating user can create and publish after both members consent; output is an immutable bounded snapshot (at most 36 messages at or before the approved cutoff, exact texts). The feed checks ongoing consent on every read; consent withdrawal removes visibility. Direct reads of the episode table are not granted.

New UI: one request / review messages / allow-or-decline / create-and-publish button / authenticated Stories feed of real comic-panel episodes. No paid art provider enabled.

Scope limits: initial request covers up to 36 messages before the cutoff, not arbitrary non-contiguous message selection. No full episode editing or groups yet. Advanced screenshot/scraping hardening is explicitly postponed. Publishing out of closed groups remains prohibited as a product rule.

Privacy test: PR35 one-permission PostgreSQL integration checks pre-approval refusal, cross-user impersonation rejection, no future-message leak, exact authorized source texts, withdrawal hides feed entry and direct table read denied.

Important rollout gate: remote Supabase staging migration version history differs from GitHub original filenames due to earlier connector-run timestamps. Reconcile migration history via approved migration-repair mechanisms before running automatic db push; do not replay applied migrations. Validate with normal CI, local PostgreSQL tests and real two-user staging browsers before treating PR-35 as released.
