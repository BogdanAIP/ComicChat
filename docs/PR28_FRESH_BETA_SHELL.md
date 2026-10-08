# PR-28 — fresh-project beta shell

Date: 2026-10-08  
Base: `main@e1d50da237dfcf4b625f59d1f94a9b759686a88c`

## Goal

Close two practical blockers before public frontend staging:

1. a clean Supabase project must be reproducible from `supabase/migrations` without manually running the upstream `database.sql`;
2. after sign-in, the product must open **ComicChat**, not the legacy public-room UI inherited from the fork.

This PR intentionally removes work instead of adding another framework.

## Reuse decision

Rakazo Market had no relevant resolver for a beta navigation shell, and no task-specific Skill that should replace a two-state existing React shell.

The shortest path is therefore to **adapt existing components**:

- keep `Auth`;
- keep `Profile`;
- make the already-built and security-tested `ComicDirectMessages` the primary signed-in surface;
- stop importing/rendering the legacy `Chat` component in the closed-beta homepage.

No new chat UI system is introduced.

## Minimal profile baseline

The original fork stores profile metadata in `public."user"`. The protected ComicChat RPCs also use that table for usernames and user discovery.

Previously, CI created that table manually before some tests and the upstream `database.sql` contained a broader legacy schema. That meant a brand-new Supabase project was not fully reproducible through `supabase db push`.

PR-28 adds an early migration:

```text
supabase/migrations/20261004090000_pr28_profile_baseline.sql
```

It creates only what protected ComicChat needs:

- `public."user"`;
- self-only SELECT/INSERT/UPDATE RLS;
- automatic profile creation after `auth.users` signup;
- profile `updated_at` maintenance.

It **does not recreate** the upstream public chat tables, legacy direct-message tables, public chat-file bucket, audio/file features, or Cloudinary path.

User discovery remains through the reviewed `comic_search_users` SECURITY DEFINER RPC rather than exposing every profile row directly to authenticated browsers.

## ComicChat-first shell

The signed-in homepage now starts with:

```text
tab = private
```

The main navigation exposes:

- ComicChat;
- Profile.

The legacy public-room Chat component remains in the repository for provenance/possible later cleanup, but is not imported into or reachable from the closed-beta homepage.

Profile Back returns to ComicChat.

This means a beta tester no longer lands in the upstream product before discovering the actual ComicChat experience.

## Fresh-project verification

Normal CI no longer creates `public."user"` as hidden setup.

Instead:

1. the plain PostgreSQL job creates only Supabase-compatible auth/realtime stubs;
2. PR-28 profile migration creates the profile table;
3. PR-02 and later migrations apply afterward;
4. the integration test inserts rows into `auth.users`;
5. the signup trigger must create both profile rows;
6. authenticated user A can read/update only A's direct profile row;
7. A cannot directly read/update B;
8. `comic_search_users` can still discover B by username;
9. anonymous direct profile reads fail.

Local Supabase MCP/Realtime jobs likewise verify the migrated baseline instead of creating it themselves.

## Frontend staging direction

No `vercel.json` is added.

ComicChat is a standard Next.js application with a Pages Router API route and OAuth consent page. Vercel's normal GitHub import path auto-detects Next.js, so adding custom platform configuration before it is required would only create maintenance work.

The frontend needs the existing public build-time variables:

- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
- `NEXT_PUBLIC_SITE_URL`.

Legacy SMTP/Cloudinary variables are not required for the ComicChat-first beta shell.

Once a Vercel project is connected, the next acceptance step is a real two-account browser session against the staging Supabase project.

## Exit criterion

PR-28 is complete when:

- CI passes without manually synthesizing `public."user"`;
- a signup creates its profile through the migration-owned trigger;
- profile direct access is self-only;
- secure user discovery still works;
- the signed-in homepage opens ComicChat immediately;
- the legacy public room is absent from beta navigation;
- all existing ComicChat security/realtime/media/MCP tests remain green.
