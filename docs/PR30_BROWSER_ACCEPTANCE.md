# PR-30 — two-account browser acceptance

Date: 2026-10-08  
Base: `main@411b030ddf5f2f2f5e7c6a54818d15a6221e05f3`

## Goal

Close the next deployment-readiness gap with a reproducible browser-level acceptance test.

The test must prove that the already-built ComicChat product works through the real web UI with two independent browser sessions:

1. both users sign in normally;
2. both set their username through the Profile UI;
3. each user finds the other through ComicChat search;
4. both open the same private conversation;
5. A sends an exact message;
6. B receives it through Realtime without a reload;
7. B replies;
8. A receives the reply through Realtime without a reload.

The test deliberately exercises the product boundary rather than calling ComicChat RPCs directly.

## Reuse decision

Rakazo Market returned browser semantic/debug resolvers and the installed `chrome-devtools` Skill. Those are useful for interactive diagnosis, but they do not provide a deterministic CI acceptance suite.

For reproducible multi-user browser testing, PR-30 reuses Playwright's official BrowserContext isolation model. Two independent contexts in one test behave like two clean browser profiles, which is exactly the chat scenario we need.

The workflow follows the official Playwright CI pattern:

- install app dependencies;
- install a pinned Playwright test runner;
- install Chromium + OS dependencies;
- run one worker for stability.

Official references:

- https://playwright.dev/docs/browser-contexts
- https://playwright.dev/docs/ci

No browser automation runtime is added to the ComicChat production bundle. The Playwright package is installed only inside the acceptance workflow with `--no-save --package-lock=false`.

## Stable browser contract

PR-30 adds `data-testid` attributes only to already-existing interactive elements:

- auth email/password/submit;
- ComicChat/Profile navigation;
- profile readiness/edit/input/save;
- private shell, user search/results;
- conversation selector/title/realtime state;
- composer/send.

These attributes do not change authorization, rendering, database behavior, or production capabilities. They prevent the acceptance test from depending on CSS module hashes or Arabic/English UI text.

## Local PR acceptance

On relevant pull requests, `.github/workflows/browser-acceptance.yml` starts:

- a clean local Supabase project;
- the normal Next.js app;
- Chromium through Playwright.

The test creates two confirmed **ephemeral local Auth users** using the local Supabase service-role key. That key exists only inside the disposable local CI stack.

The browser itself then uses normal email/password sign-in and normal application UI/RPC paths. The test never injects a browser session or calls private ComicChat RPCs directly.

Because local Supabase is destroyed after the job, no destructive account cleanup API is needed. This is important because ComicChat intentionally guards hard deletion while shared history exists.

## Staging acceptance

The same test can be run manually against a deployed frontend:

```text
Browser acceptance
  -> workflow_dispatch
  -> target = staging
  -> site_url = https://<staging-host>
```

The `comicchat-staging` GitHub Environment must contain four dedicated, ordinary test-account secrets:

- `STAGING_E2E_USER_A_EMAIL`
- `STAGING_E2E_USER_A_PASSWORD`
- `STAGING_E2E_USER_B_EMAIL`
- `STAGING_E2E_USER_B_PASSWORD`

The staging browser job does **not** receive a Supabase service-role key, database password, OpenAI key, or privileged management token.

The dedicated accounts may persist between runs. Each run assigns fresh unique usernames through the UI and sends fresh unique message text, so existing conversation history does not create false positives.

## Relationship to deployment

PR-27 already provides the Supabase staging activation path. PR-28 made a fresh Supabase project migration-complete. PR-29 made the frontend ComicChat-first.

PR-30 makes browser acceptance ready before the public frontend exists. Once a Vercel project or another HTTPS frontend is connected, the staging workflow can immediately validate the deployed product without adding another test implementation.

The Vercel ChatGPT connector is available but was not installed when PR-30 was prepared, so this PR does not claim or fake a live frontend deployment.

## Exit criterion

PR-30 is complete when:

- the normal CI/static gate remains green;
- local browser acceptance passes with two independent Chromium contexts;
- A→B and B→A exact text arrives through Realtime without manual reload;
- staging mode exists and uses only ordinary dedicated test-account credentials;
- no service-role or provider key is exposed to the staging browser job.
