# PR-37 — Stories compiled from live group comic messages

## User-defined product flow
ComicChat is a messenger-first comic social network. A member selects existing messages in a group chat and compiles a readable episode from their *real* comic panels. No separate prompt-to-comic creator, automatic scene grouping, or artificial participants.

## Behavior
- Every group member may select 1–36 messages from the same group and compile a comic episode with a title. The order is chronological; original text/speakers/timestamps are snapshotted exactly and cannot be silently expanded or rewritten.
- **Closed group**: compiling makes a group-only episode visible to current members of that group, never a public Stories post. The API denies direct public publication even if a client bypasses the button; original messages/IDs are not exposed via any public RPC. Members removed from the group lose access.
- **Ordinary public group**: members accepted public-story re-use rules when they joined. The original author of the compiled episode can publish it with a single explicit action. No per-episode approval is needed from contributors. Server checks each selected message sender accepted the current group terms **before sending that message** and is still a member; if not, publishing fails closed. Members can read group-only episodes even before publication.
- Public story feed merges published 1:1 approved episodes and public-group episodes, each presented as genuine comic panels; no group-only story appears in the public RPC.
- Advanced anti-scraping/watermark/screenshot controls for closed groups remain parked by user decision. Restricted/adult-group creation and external paid art generation remain disabled.

## Safeguards
All episode tables have RLS and no direct authenticated read/write grants. Only explicit auth.uid-bound SECURITY DEFINER RPCs manage compilation, visibility and reads, with pinned search_path. All requested source IDs must exist in the caller's group; cross-conversation IDs and duplicates are rejected. A user cannot publish another member's episode. Changing membership or public-group terms can immediately remove eligibility of an already published group episode, without giving a false guarantee of recalling prior screenshots.

## Tests and release
PR37 PostgreSQL script tests 3 member roles, exact-panel selection and chronological ordering, foreign message injection, closed-group public leak attempts, public-group join terms, publication, changed/revoked consent, membership removal, and direct table permissions. Extend local Playwright 2-account group test to compile and privately share a closed-group episode, then verify it is absent from the public feed. Do not declare live remote 3-account staging E2E successful without running it. Before release, run CI and browser acceptance, then apply ONLY new PR37 migration to connected Supabase staging, then deploy main via Vercel.
