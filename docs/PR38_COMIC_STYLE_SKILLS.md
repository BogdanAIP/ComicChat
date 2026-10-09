# PR-38 — ComicChat versioned Style Skills

## User-approved design

The product's core is LIVE comic-message conversations. The style is attached to the conversation (private 1:1 or ordinary group), NOT a separate create-comic tool.

Initial five selectable visual Style Skills: **anime, manga, superhero, cartoon, romance/flirt**. **Realism is deliberately excluded** — not a selectable preset and not accepted as a blend component. Adult explicit art, hentai and other age-gated options are NOT activated in this release.

## Reuse, not more infrastructure

The existing ComicPanel/TemplateRenderer, immutable source text, render job queue, character continuity, private media protections and opt-in Edge renderer are reused. Style Skill metadata is in `utils/comicStyleSkills.mjs` and is shared by the web UI and the future opt-in art generator.

Each Skill contains visual prompt guidance, negative constraints, palette and speech bubble geometry. `resolveStyleSkill` generates a stable, versioned art-direction prompt and composes a secondary skill with a user-chosen 10–90% mix. Original message text is *never* executed as an instruction. No extra remote provider, paid API call or realtime cost is introduced.

## Permissions and history

- Either private conversation member can choose the shared style.
- Only the group owner can change a group's shared style.
- SQL `comic_set_conversation_style` validates an allowlist server-side; direct mutation of style tables is forbidden.
- `comic_snapshot_message_style` stores a **frozen** primary/secondary/version combination at message INSERT time. Old messages receive the `classic` compatibility marker, preserving their earlier presentation rather than re-rendering retrospectively.
- `comic_list_message_styles` and `comic_get_conversation_style` are membership-guarded and return only authorized conversation information.
- Newly compiled stories preserve each source message's frozen style data. Future chat-style changes do not edit existing messages or episode panels.
- Sender identity (rather than each message ID) anchors character silhouette for newly styled messages in the immediate deterministic comic preview.
- Explicit adult/erotic generation is not enabled without platform/age safety requirements.

## Provider boundary and deployment

The code of the previously existing `comicchat-render` Edge Function has been prepared to consume immutable message-time Skill instructions in a prompt, while retaining the previous fixed fictional adult character identity and approved private reference support. Its external generation remains OFF and uses no paid calls. **A code change to the Edge Function is not automatically deployed by a Vercel redeploy.** Before any future opted-in image-provider activation, deploy/test this revised Edge function explicitly and verify compatibility with connected Supabase.

## Release gates

- JS style registry tests, legacy golden tests and lint/build.
- PostgreSQL authenticated 1:1 and group membership/owner tests, invalid-realism rejection, mix validation, per-message immutable styles, story snapshot preservation, ex-member read prevention, no authenticated direct table access.
- Existing local 1:1 and group Playwright acceptance preserved.
- Apply only new PR38 migration on Supabase staging after passing CI; do NOT run unsafe automatic `supabase db push` because remote migration version history drift remains.
- Final remote multi-account staging approval remains an open separate QA task. Do not claim fully exercised live style generation when paid provider disabled.
