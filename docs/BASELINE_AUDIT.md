# PR-01 — Baseline audit

Date: 2026-10-05  
Repository: `BogdanAIP/ComicChat`  
Baseline commit: `3ebb5fd00a2c83eb94a708168b3302b4eca4c631`

This document records the inherited upstream baseline before ComicChat product refactoring. It is evidence for the P0 gate in `ROADMAP.md`, not a claim that the ComicChat domain model is already implemented.

## 1. Reproducible baseline

Verified on the paired Windows host from a clean clone:

- Git: `2.51.1.windows.1`
- Node: `22.23.3`
- npm: `10.9.9`
- Repository declares Node `>=20.9.0`; `.nvmrc` pins Node `20`.
- `npm ci`: **PASS**; 353 packages installed, 354 audited.
- `npm run build` with placeholder public Supabase values: **PASS** on Next.js `16.3.6`.
- Legacy `npm run lint`: **FAIL** before this PR because `next lint --dir .` is not a valid Next.js 16 lint command.
- Final PR-01 lint after migration/fixes: **PASS** with 0 errors and 8 non-blocking warnings.
- Final PR-01 production build after lint fixes: **PASS**.

The build emitted a host-specific warning about a separate `C:\Users\eahra\package-lock.json` outside this repository. It did not affect the successful ComicChat build and must not be "fixed" by touching unrelated files outside the project.

### Resolved dependency versions from package-lock.json

| Package | Declared range | Resolved baseline |
| --- | --- | --- |
| Next.js | `^16.2.3` | `16.3.6` |
| React | `^18.2.0` | `18.3.1` |
| React DOM | `^18.2.0` | `18.3.1` |
| Supabase JS | `^2.39.0` | `2.109.0` |
| Framer Motion | `^11.18.2` | `11.18.2` |
| Nodemailer | `^8.0.5` | `8.0.11` |
| ESLint | `^9.0.0` | `9.39.5` |
| eslint-config-next | `^16.2.3` | `16.3.6` |

The preserved upstream README still advertises Next.js 14.x. Runtime/lockfile evidence is authoritative for this fork.

## 2. Package-manager and CI findings

The inherited repository contained both `package-lock.json` and `yarn.lock`. ComicChat CI uses npm and `npm ci`; PR-01 removes `yarn.lock` so `package-lock.json` is the single baseline lockfile.

The existing CI workflow is structurally appropriate for a baseline gate: clean checkout, Node setup, `npm ci`, lint, and production build with placeholder public Supabase values. Before PR-01, GitHub reported **zero workflow runs** for the fork, so CI had not been empirically demonstrated on ComicChat.

PR-01 migrates linting to ESLint 9 flat config and `eslint .`, matching the current Next.js guidance. The legacy `.eslintrc.json` is removed. The new rules exposed 61 inherited errors; the conditional Hooks were fixed structurally rather than disabling `rules-of-hooks`. One narrow suppression remains around the inherited denormalized thread-preview cache and is explicitly tagged for PR-02. Final lint result is 0 errors / 8 warnings.

The inherited `update-packages.yml` scheduled `npm update` / `npm audit fix` and pushed changes directly. ComicChat already has Dependabot configured for npm PRs, so the direct-push updater is removed in this PR to preserve reviewable dependency changes.

## 3. Dependency audit

The clean install reported **6 high-severity npm audit findings** and no critical findings.

Observed affected packages included:

- direct: `nodemailer`
- direct/dev: `eslint-config-next`
- transitive through the lint stack: `@next/eslint-plugin-next`, `braces`, `fast-glob`, `micromatch`

The audit suggested breaking-version remediation paths. PR-01 does **not** apply `npm audit fix --force` or automatic major downgrades/upgrades. Dependency remediation must be reviewed separately against build/lint behavior.

## 4. Inherited application inventory

### Reuse candidates

- Next.js Pages Router shell.
- Supabase authentication/session handling.
- Existing direct-message UI and realtime subscription patterns.
- Existing user-profile UI.
- File/audio UI components as references.
- Existing deployment shape and environment template.

### Refactor before ComicChat MVP

- Direct-message tables and policies into explicit `Conversation`, `Membership`, `Message`, `GenerationJob`, `Asset`, `CharacterProfile`, and `UsageLedger` boundaries.
- Realtime delivery so one `message_id` transitions `queued -> rendering -> ready | failed` in place.
- Media access from public URLs to participant-authorized private objects or signed access.
- Auth and database functions so every conversation/message read and write is membership-scoped.
- File/upload pipeline behind a storage adapter.
- Notification API behind server-side membership and recipient validation.
- Text bubbles into comic-first visual message cards while preserving verbatim source text.

### Remove or keep out of the critical path

- Public/global chat room as a default product surface.
- Automatic SMTP email notifications for MVP.
- Unsigned/public Cloudinary upload as a default private-chat storage path.
- Voice notes until the comic-message pipeline is stable.
- Any dependency updater that writes directly to `main`.

Nothing in this PR deletes product UI purely for cleanup; this is an inventory gate.

## 5. Database / authorization findings

The inherited schema is useful as a prototype but is **not safe enough to serve as the ComicChat private-message authorization model without refactoring**.

### P0 blockers for PR-02

1. **DM UPDATE policy is too broad.**  
   `dm_update_status` allows either participant in a thread to UPDATE matching `direct_message` rows, but the policy does not restrict updates to `delivered_at` / `read_at`. The database boundary therefore does not enforce the intent implied by the policy name.

2. **Thread insertion is too permissive.**  
   `dm_thread_insert` uses `WITH CHECK (true)`, so the policy itself does not require the authenticated caller to be one of the two participants.

3. **SECURITY DEFINER function accepts arbitrary user identity.**  
   `get_threads_with_last_message(user_id UUID)` is granted to authenticated users and accepts a caller-supplied user ID. It must be redesigned so authorization derives from `auth.uid()`, not trusted input. SECURITY DEFINER functions also need an explicit safe `search_path`.

4. **Private media is currently public-oriented.**  
   The documented Supabase storage path uses `getPublicUrl`, and the sample storage policy permits public reads. Cloudinary support uses unsigned uploads when configured. That violates ComicChat's private-by-default invariant.

5. **Public room intentionally exposes messages to all authenticated users.**  
   `public.message` has a SELECT policy allowing all authenticated users. That may be valid for the upstream lounge but must not be reused as a private ComicChat message model.

6. **User profiles are globally readable.**  
   `public.user` uses `USING (true)` for profile reads. ComicChat needs an explicit product decision about discoverability before this can be considered acceptable.

## 6. Server/API findings

`pages/api/notify-direct-message.js` validates that the caller has a valid Supabase token, but accepts `recipientEmail`, `recipientName`, `messagePreview`, and `threadId` from the request body without server-side proof that:

- the caller belongs to that thread,
- the recipient is the other thread participant,
- the recipient email belongs to that participant.

The in-memory rate limiter is also instance-local and not a durable anti-abuse boundary. This endpoint should not be carried into ComicChat private messaging unchanged.

## 7. Secrets and environment

Positive baseline properties:

- `.env.local` and environment-specific local files are gitignored.
- `.env.example` contains placeholders rather than live credentials.
- Browser code uses only `NEXT_PUBLIC_*` Supabase values intended for the client.
- SMTP credentials are server environment variables.

Required follow-up:

- keep privileged/service-role Supabase keys server-only if introduced later,
- never place OAuth/provider tokens in `NEXT_PUBLIC_*`, source control, URLs, or logs,
- protect generated assets independently of obscurity of object URLs.

## 8. Upstream divergence

The fork baseline diverged from upstream after 2026-10-01. The latest observed upstream change on 2026-10-05 was an automated dependency update affecting `package-lock.json`.

Do not merge upstream dependency updates blindly. Review them as explicit dependency PRs against ComicChat's build, lint, audit, and security gates.

## 9. PR-01 decision

**Build viability: GO.** The inherited app can install and build successfully.

**Authorization/media model for ComicChat: NO-GO until PR-02 refactor.** Existing RLS, SECURITY DEFINER functions, notification validation, and public media assumptions are not sufficient for ComicChat's private-by-default requirements.

### Exit criteria from PR-01

PR-01 is complete when:

- the PR branch has a current lint configuration,
- clean CI runs `npm ci -> npm run lint -> npm run build`,
- this audit is reviewed as the baseline record,
- no direct-push dependency updater remains,
- the next task starts from the P0 security/DM model findings above.
