# PR-06 — ChatGPT Sites deployment and portability spike

Date: 2026-10-05
Base: main@4a89984304674589ca884ee57a6e32fb35d4e465

## Decision

GO for an isolated ChatGPT Sites frontend/runtime compatibility spike while keeping the current Supabase backend.

NO-GO for an immediate migration of the ComicChat backend to D1/R2 or a Sites-native identity model.

This is a compatibility decision, not a claim that ComicChat is already deployed on ChatGPT Sites.

## Why this gate exists

The current private ComicChat path is intentionally secure, but it is not backend-neutral:

- utils/useSupabase.js creates a Supabase client directly and owns Supabase Auth/session lifecycle;
- components/ComicDirectMessages.js calls Supabase RPCs, reads comic_message through PostgREST, and subscribes to private Supabase Broadcast topics;
- the database contract relies on PostgreSQL RLS, auth.uid(), SECURITY DEFINER functions, triggers, transactions, and row locks;
- PR-05 worker state uses PostgreSQL FOR UPDATE SKIP LOCKED, service-role-only RPCs, leases, and transactional ledger writes.

Those semantics are security properties, not implementation details that may be silently replaced.

## Current OpenAI Sites evidence

Official OpenAI guidance reviewed on 2026-10-05:

- ChatGPT Sites is a hosted runtime in public beta.
- OpenAI explicitly warns that compatibility depends on the Sites runtime and account capabilities; some frameworks, databases, background services, private networks, and hosting patterns may not be supported.
- The official help documentation refers to D1/R2 data and file storage, but that does not make the current Supabase/PostgreSQL schema a drop-in D1 workload.
- A Site can have its own sign-in feature when supported and intentionally added; Site audience controls and in-app authentication are separate concerns.
- Site schedules may exist, but scheduled tasks have their own data-access constraints. That is not equivalent to PR-05's continuously claimable transactional worker.

Primary reference:
https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites

Related plugin-hosting reference:
https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites

Because public documentation leaves some runtime compatibility conditional, the final answer must come from an actual Sites compatibility/save-version test, not inference from documentation.

## Compatibility matrix

| Boundary | Current ComicChat | PR-06 decision |
|---|---|---|
| UI/build | Next.js production build is CI-verified | Run actual Sites compatibility conversion before claiming support |
| Identity | Supabase email/password auth | Keep for first spike; adapter required before any identity switch |
| Data API | Supabase PostgREST + RPC | Keep for first spike |
| Authorization | PostgreSQL RLS + auth.uid() + SECURITY DEFINER | Preserve; do not translate casually to client-side checks |
| Realtime | Private Supabase Broadcast | Keep initially; verify external connectivity and two-account delivery in Sites |
| Queue/ledger | PostgreSQL transaction + locks + leases | Keep; Sites background-worker support must not be assumed |
| Media | Disabled on secure ComicChat path | Remains disabled until private signed-media design |
| D1 | Not used | Candidate only behind a future persistence adapter |
| R2 | Not used | Candidate only behind a future private asset adapter |
| Legacy upload/email | Inherited files remain in repository | Not part of ComicChat private path or this deployment gate |

## Why D1 is not a drop-in replacement

The secure domain currently depends on PostgreSQL behavior:

1. membership-scoped RLS;
2. auth.uid();
3. SECURITY DEFINER RPC boundaries with pinned search_path;
4. atomic message + receipt + generation-job + ledger creation;
5. unique/idempotent constraints;
6. row-level worker claiming with FOR UPDATE SKIP LOCKED;
7. database-triggered private Broadcast.

A D1 migration must reproduce the security and transaction semantics, not merely copy table names. Until that adapter exists and passes equivalent A/B/C and reconnect tests, Supabase/PostgreSQL remains the canonical backend.

## First real Sites experiment

When we perform the actual Sites step, use this order:

1. Open this repository in ChatGPT Work/Codex with Sites available.
2. Ask Sites to assess/convert the existing project without changing ComicChat security semantics.
3. Do not invent or commit fake Sites project identifiers.
4. Configure environment values through the supported Sites settings, not source control.
5. Save a version before any deployment.
6. Verify the existing public web build loads.
7. Verify two independent users can authenticate.
8. Verify A can open a conversation with B and C cannot access it.
9. Verify send, idempotent retry, private Broadcast delivery, disconnect/reconnect history, and receipts.
10. Verify a PR-05 message creates exactly one generation job and sender-owned ledger rows.
11. Record resulting hosting/runtime constraints back into this document.

A successful UI render alone is not sufficient.

## Worker decision

PR-05 intentionally ships a worker contract, not a continuously running dispatcher. PR-06 does not place that dispatcher inside Sites because current official guidance says some background-service patterns may be unsupported.

The safe order is to keep the transactional PostgreSQL worker contract, separately choose a supported worker host or explicitly verified Sites mechanism, and only then attach the mock/real provider dispatcher.

## Media decision

The inherited utils/fileUpload.js can use Cloudinary or Supabase public URLs, but the secure ComicChat private path does not import or use it. Likewise the inherited pages/api/notify-direct-message.js is not part of the secure private path.

PR-06 keeps both outside the portability MVP. Private media will require a signed/access-checked asset abstraction before any R2/Supabase Storage decision.

## CI evidence

npm run portability:pr06 verifies that:

- the machine-readable compatibility decision stays present;
- the secure private path still has the known Supabase/RPC/Realtime dependencies that make a backend migration non-trivial;
- the current PostgreSQL migration still contains the security/transaction primitives that must be preserved;
- legacy public upload and email notification modules are not imported by ComicDirectMessages;
- the repository does not falsely claim a completed Sites deployment.

## Gate result

PR-06 can be merged when documentation + static boundary checks pass alongside all PR-02 through PR-05 functional/security gates.

After merge, the next external deployment evidence must come from an actual ChatGPT Sites run. Until then the project state is:

Sites frontend/runtime spike approved; backend migration deferred; deployment compatibility not yet proven.
