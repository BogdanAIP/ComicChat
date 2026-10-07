# ComicChat — reuse-first fast-track

## Purpose

ComicChat remains a **separate product and repository**. Rakazo, Market Skills, Market Resolver, coding agents, MCP servers and other developer tooling may accelerate development, but **must not become runtime dependencies of ComicChat merely because they were used to build it**.

The product goal is not to maximize custom code. The goal is to reach a working, testable ComicChat as quickly as possible while preserving the product-specific invariants already established.

## Mandatory rule

> **Reuse first. Adapt second. Create last.**

Before implementing a new subsystem or substantial feature, the developer/agent must first determine whether a maintained component, SDK, service, repository, Skill or resolver-known implementation already solves most of the need.

For development work, prefer this order:

1. Search **Rakazo Market Resolver** for concrete implementations that satisfy the capability.
2. Search **Rakazo Market Skills** for reusable implementation/review/testing workflows.
3. Search official vendor repositories/docs and mature maintained open-source projects when Market coverage is incomplete.
4. Prefer configuration/composition or a thin adapter over copying/reimplementing a subsystem.
5. Write custom code only for:
   - ComicChat-specific product behavior;
   - an integration boundary that cannot be satisfied safely by an existing component;
   - a measured incompatibility documented in the PR.

If Rakazo Market/Resolver is unavailable in a particular development session, perform the equivalent search manually and record the evidence. Work must not block solely on Rakazo availability.

## Product/runtime boundary

Using Rakazo or a Skill during development does **not** authorize adding Rakazo as an application dependency.

ComicChat runtime should remain independently buildable and deployable. Any proposed runtime dependency must be justified on its own merits and reviewed like any other third-party dependency.

Do not move ComicChat domain state into Rakazo. Do not require a Rakazo host, bot, project, database or Windows Host for normal ComicChat operation.

## What should remain custom

These are product invariants, not commodity infrastructure:

- one stable message identity while a pending comic becomes a rendered comic;
- exact original text preservation and deterministic text overlay;
- sender-attributed generation/billing ledger;
- comic scene/character continuity rules;
- authorization around private conversations and comic assets;
- web and ChatGPT surfaces observing the same ComicChat message IDs;
- fail-safe behavior when image generation fails.

Existing libraries can implement pieces underneath these boundaries, but they must not silently change the semantics.

## Commodity features: stop before coding

Do **not** start a custom implementation of these areas until a reuse scan has been recorded:

- auth/session UI;
- realtime transport primitives;
- chat list/message list/composer;
- presence, typing indicators, unread state;
- file/media upload plumbing;
- push/email notifications;
- moderation primitives;
- generic rate limiting;
- observability/log aggregation;
- browser/E2E automation;
- image-provider SDK integration;
- generic retry/queue libraries;
- generic MCP protocol plumbing.

## Initial fast-track audit

| Capability | Current ComicChat position | Reuse candidates / direction | Decision now |
|---|---|---|---|
| Auth + database authorization | Supabase + ComicChat RPC/RLS | Supabase native auth/RLS; avoid replacing proven domain authorization | **Keep** |
| Realtime message persistence | Supabase-backed protected path | Supabase Realtime/UI; Stream/Sendbird/CometChat/Liveblocks are migration candidates only if they materially shorten delivery | **Keep backend for now; reuse UI/primitives selectively** |
| Chat UI shell | inherited fork + ComicChat components | official/vendor chat UI kits and Supabase UI components | **Prefer replacement/composition over custom commodity UI** |
| Comic panel state/rendering | ComicChat-specific | generic canvas/layout/image libraries may help underneath | **Keep domain layer custom** |
| Image generation provider | MockProvider only | official image APIs/SDKs and maintained provider adapters | **Integrate, do not implement a model/provider stack** |
| Character/style consistency | product requirement, not complete | provider reference-image/consistency capabilities, maintained workflows | **Search before building custom system** |
| Queue/retry | current generation-job logic | managed/native queue or small maintained library if it reduces code without weakening invariants | **Reuse where safe** |
| Blocking/reporting/export/privacy | already implemented and tested at DB boundary | vendor moderation helpers can supplement, not replace ComicChat authorization | **Keep proven boundary** |
| MCP/ChatGPT transport | thin ComicChat Edge/MCP adapter | official MCP/ChatGPT SDK/tooling | **Keep adapter thin; reuse protocol tooling** |
| Browser/E2E/security review | project tests + manual agent work | Market Skills, Playwright/Chrome DevTools/GitHub tooling | **Reuse-first immediately** |
| Development process | previously feature-first | Rakazo Market Skills + Resolver + official repositories | **Mandatory reuse gate** |

The audit is intentionally conservative about replacing the current Supabase backend because many privacy and cross-account guarantees are already proven there. A vendor migration is worthwhile only if a time-to-product comparison shows a clear net win **from the current state**, not from a hypothetical greenfield start.

## PR reuse gate

Every substantial PR must answer:

- **Capability:** what user/product capability is being added?
- **Resolver search:** what existing implementations were considered?
- **Skill search:** what reusable development/test workflows were used?
- **Reuse decision:** reuse / adapt / create.
- **Why custom code remains:** exact ComicChat-specific incompatibility or invariant.
- **Exit criterion:** how we know the selected path is faster or safer than the alternatives.

A docs-only typo or tiny local fix does not require a full market scan.

## Development Skills worth installing/creating

Prefer existing trusted Skills first. If none exist, a ComicChat-owned development Skill is justified only when the workflow will repeat. High-value candidates are:

- feature reuse scan / build-vs-buy review;
- Supabase RLS/security review;
- MCP two-account acceptance;
- Playwright browser acceptance;
- comic-panel visual regression;
- image-provider evaluation;
- release/readiness review.

These Skills belong to the **development workflow**. They do not become end-user ComicChat features automatically.

## Skills inside the ComicChat product

Core messaging, authorization, ledger accounting and message state transitions remain deterministic application code.

Skills may be appropriate later for optional AI behavior where instructions genuinely vary, for example:

- scene direction and prompt construction;
- character/style continuity checks;
- render failure diagnosis/retry strategy;
- comic export/layout workflows;
- optional creative transformations.

Such Skills must not be able to bypass conversation authorization, alter the verbatim stored message, or choose a different user's billing source.

## Current execution rule

Before PR-25 or any further feature expansion, apply this audit to the next planned capability and prefer a ready-made component/provider where it produces a net reduction in implementation and maintenance work.


## First gate execution — 2026-10-07

The policy was exercised immediately against the next development areas rather than being recorded only for future use.

Rakazo Market searches found:

- browser/E2E: relevant curated first-party `ChromeDevTools/chrome-devtools-mcp` Skills are available and should be reused for browser debugging/automation workflows;
- chat/realtime UI: no relevant resolver entry was returned;
- observability/readiness: no relevant resolver entry was returned;
- image generation/character consistency: no relevant resolver entry was returned.

Some broad Skill searches returned unrelated trading entries, confirming that ranking/catalog coverage is not yet sufficient for these ComicChat domains. Therefore the fallback rule applies: use official vendor repositories/docs and maintained open-source projects for these gaps, record the comparison, then reuse/adapt/create.

This also changes priority: do not add another infrastructure-only milestone merely because it is next numerically. Prefer the shortest path from the current tested backend to a real end-to-end comic generation experience.
