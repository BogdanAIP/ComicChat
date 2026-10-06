# PR-07 — identity and provider-permission spike

Date: 2026-10-05
Base: main@0d10573a40766e041d1c10799e81210ccf5e86b2

## Result

ComicChat must treat three OpenAI capabilities as separate permissions:

1. Sign in with ChatGPT identity;
2. ChatGPT plan usage for eligible Responses API inference;
3. image-generation capability and its billing source.

None of those implies either of the others.

Current decision:

- keep the existing Supabase ComicChat account/session as the canonical local identity;
- do not implement a production OpenAI account-link flow until ComicChat has an approved Sign in with ChatGPT client/integration path;
- do not enable ChatGPT-plan-funded comic image generation;
- keep the PR-05 mock provider and sender-attributed ledger as the safe integration boundary;
- allow future provider activation only after the exact provider + billing path passes the evidence gate below.

## Current official OpenAI evidence

Official documentation reviewed on 2026-10-05:

- Sign in with ChatGPT can provide identity and, separately, optional ChatGPT plan usage when the corresponding scopes and product access are available.
- Identity scopes do not grant access to ChatGPT conversations or OpenAI API resources.
- ChatGPT plan usage requires separate authorization and the chatgpt.tokens.use.direct scope.
- The open-source plan-usage flow is documented for open-source/local clients. OpenAI directs paid or remotely hosted apps to request access; selected private clients/partners may receive access separately.
- Current ChatGPT plan-usage preview limitations explicitly list image generation as an unsupported tool.
- OAuth access/refresh credentials must not be placed in browser storage, source control, URLs, logs, analytics, or support transcripts.
- Usage-limit, eligibility, revocation and temporary availability errors must be surfaced rather than silently switching to another user's plan or an undisclosed billing source.

Primary references:

https://developers.openai.com/siwc/quickstart
https://developers.openai.com/siwc/token-sharing-open-source
https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
https://developers.openai.com/siwc/ui-ux-guidelines

## Consequence for the original ComicChat sender-pays idea

The intended product behavior is: sender A writes a comic message and only A pays for that message's AI image; sender B's resources are never used.

The current ChatGPT plan-usage preview cannot satisfy that for the image itself because image generation is explicitly unsupported on that route.

Therefore the status of sender-pays via the user's ChatGPT plan is:

**BLOCKED for comic image generation, not implemented, and not a production fallback.**

This is narrower than saying Sign in with ChatGPT is unusable. Identity can still become useful later, and approved plan usage could power eligible text/model calls. It simply cannot currently be treated as the image billing mechanism ComicChat needs.

## Local identity and account-link model

When an approved identity integration becomes available, the application must keep two identities distinct:

- local ComicChat user ID: authorization key for conversations, memberships, messages and sender ownership;
- verified OpenAI OIDC subject: optional external identity linked to that local account.

Rules:

1. Never use email as the durable OpenAI identity key; verify the ID token and use its stable subject.
2. Account linking must require an authenticated local session plus a freshly verified OpenAI sign-in result.
3. A changed OpenAI subject must never silently replace an existing link.
4. Revoking OpenAI access must not delete or reassign ComicChat messages.
5. Private-chat RLS remains keyed to the ComicChat/Supabase user ID unless a separately reviewed migration replaces that authority.

PR-07 intentionally does not add an account-link table yet because doing so before an approved callback/client flow would create unused security surface.

## Token boundary

OpenAI OAuth credentials are bearer credentials and must stay outside the browser UI.

ComicChat runtime policy for any future integration:

- no access or refresh token in localStorage, sessionStorage, IndexedDB or URL parameters;
- no token in NEXT_PUBLIC variables;
- no token in GitHub, logs, analytics, error telemetry or support transcripts;
- browser receives only the application's own session and non-secret connection status;
- token refresh/revocation handling occurs in a trusted backend or an explicitly supported local runtime.

## Provider and billing boundary

PR-05 already records sender_id, provider, billing_source and job status. PR-07 keeps that contract and refuses implicit billing substitution.

Current production-capability matrix:

| Capability | Status | ComicChat action |
|---|---|---|
| Supabase local identity | verified current path | keep canonical |
| Sign in with ChatGPT identity | integration access required | design only |
| ChatGPT plan usage for eligible Responses requests | approval/eligibility dependent | do not assume |
| ChatGPT plan usage for image generation | unsupported in current preview | blocked |
| MockProvider | implemented, zero cost | keep |
| Official image API billed to ComicChat/app credits | not yet implemented | valid future option after explicit cost UX + provider gate |
| Other provider | not approved | disabled until separately reviewed |

## Acceptable future image paths

A future PR may enable one of these paths, but only explicitly:

### A. ChatGPT-plan sender-pays images

Enable only if OpenAI documentation and ComicChat's approved client access both support image generation through the user's plan. The two-user test must prove A's image uses A's authorization and B's image uses B's authorization.

### B. ComicChat-owned API billing

ComicChat may use a server-side image API credential and charge/consume clearly disclosed ComicChat credits. The UsageLedger must still record sender_id and the actual billing source. UI must say that the app, not the user's ChatGPT plan, is funding the request.

### C. Another approved provider

Use only through the GenerationProvider boundary with equivalent sender attribution, usage reporting, access control and error handling.

## Evidence required before ChatGPT-plan image activation

All of these must be true:

1. ComicChat has approved access for its remotely hosted application class.
2. The current OpenAI plan-usage contract explicitly supports image generation.
3. Two independent users complete authorization using their own accounts/workspaces.
4. A generation request from A cannot consume B's plan/credits even if both are members of the same ComicChat conversation.
5. Consent decline, token expiry, revocation, ineligible-user and usage-limit states are tested.
6. UI identifies the billing source before generation and never silently falls back.
7. Tokens remain inaccessible to browser JavaScript and are absent from logs.
8. The PR-05 ledger reconciles every accepted job to the sender and provider result.

## PR-07 CI gate

npm run permissions:pr07 verifies that:

- this capability decision remains machine-readable;
- ChatGPT-plan image generation remains marked unsupported/blocked;
- the production provider factory still refuses official-image;
- runtime source has no OpenAI OAuth endpoints/scopes/API secrets added prematurely;
- browser storage does not receive OpenAI bearer-token code;
- PR-05 still carries sender/provider/billing attribution.

## Gate result

PR-07 can merge as a research/security gate without enabling OpenAI OAuth or a paid provider.

Next implementation work should choose between:

- an approved real image API + explicit ComicChat credits/cost path, or
- waiting for an approved ChatGPT-plan image-generation capability.

Until one exists, MockProvider remains the only generation provider and the original text/message path remains fully functional.
