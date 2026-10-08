# PR-29 — ComicChat-first closed-beta shell

Date: 2026-10-08  
Base: `main@fdfc0a4996a762ed1698e6ea90818a7bda93445b`

## Goal

Make the signed-in product experience match the actual ComicChat beta instead of the inherited upstream chat workspace.

The protected `ComicDirectMessages` component already owns the complete beta messaging path:

- user discovery;
- direct-conversation creation;
- exact-text message send;
- realtime history;
- blocking/reporting;
- export/deletion request;
- private generated comic art.

Therefore PR-29 does not build another UI shell. It simply makes that existing surface the default product.

## Reuse decision

A Rakazo Market scan did not return a relevant ready-made beta navigation shell. The fastest path is to **adapt the existing Next.js shell** and reuse the already-tested ComicChat component.

No new UI framework, router, chat SDK, state manager, hosting adapter or runtime dependency is introduced.

## Product change

After authentication:

- the default tab is `private`;
- ComicChat opens immediately;
- navigation exposes ComicChat and Profile;
- Profile Back returns to ComicChat;
- the homepage no longer imports or renders the inherited `Chat` public-room component;
- page title/description identify ComicChat.

The legacy public-room, audio, email and attachment code remains in the repository for provenance and possible later cleanup, but it is not reachable from the closed-beta homepage.

## Deployment impact

This change pairs with PR-28's fresh Supabase bootstrap and PR-27's staging activation harness.

The standard Next.js application can be imported into Vercel without a custom `vercel.json`. The intended frontend staging variables remain:

- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
- `NEXT_PUBLIC_SITE_URL`.

Legacy SMTP/Cloudinary configuration is not required for the ComicChat-first beta shell.

## Exit criterion

- a signed-in tester lands directly in ComicChat;
- legacy public chat is absent from the beta homepage/navigation;
- Profile remains available;
- all existing build/security/MCP/Realtime suites remain green.
