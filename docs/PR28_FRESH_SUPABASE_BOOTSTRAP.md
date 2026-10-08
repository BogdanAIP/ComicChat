# PR-28 — fresh Supabase profile bootstrap

Date: 2026-10-08  
Base: `main@e1d50da237dfcf4b625f59d1f94a9b759686a88c`

## Problem found by the staging fast-track

PR-27 made remote staging deployment reproducible, but reviewing a **brand-new** Supabase project exposed a hidden baseline dependency.

The first ComicChat migration references `public."user"`, while that table previously existed only because the original upstream repository expected its standalone `database.sql` to be applied manually.

Local CI hid the gap by creating `public."user"` before running the ComicChat migrations.

Therefore:

```text
fresh Supabase project
  -> supabase db push
  -> PR-02 expects public.user
  -> deployment is not self-contained
```

## Reuse decision

The upstream repository already defines the useful profile primitives:

- `public.user`;
- self profile insert/update;
- `handle_updated_at`;
- `handle_new_user`;
- `on_auth_user_created`.

PR-28 **adapts only those primitives** into the first ComicChat migration.

It intentionally does not import the upstream public `message`, `direct_message`, public file bucket, or permissive profile-read policy.

## Why PR-02 is amended instead of adding an older migration

Supabase migration history is timestamp ordered. Adding a newly-created migration with a timestamp before already-known migrations is an out-of-order migration and may require `--include-all`.

Supabase also recommends that schema changes remain migration-driven rather than being patched directly on a remote database.

ComicChat has not yet claimed a real production/staging deployment. This is therefore the last safe point to repair the first migration itself **before the first supported remote `db push`**.

If a private developer database already marked PR-02 applied, it should be treated as a development database and reset/reconciled before using the PR-27 staging workflow.

Official migration references:

- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/reference/cli/global-flags

## Minimal owned profile schema

PR-02 now guarantees:

- `public."user"` exists with `id`, `username`, `email`, `created_at`, `updated_at`;
- `id` references `auth.users(id)`;
- RLS is enabled;
- authenticated users can select only their own profile row;
- authenticated users can insert/update only their own profile;
- anonymous users have no table access;
- the old upstream broad `Users can view all profiles` policy is removed when present;
- signup creates the profile through `on_auth_user_created`;
- profile updates refresh `updated_at`.

Other-user discovery remains through the existing `comic_search_users` SECURITY DEFINER RPC, which exposes only `user_id` and `username`, not email.

## Why self insert/update stays allowed

The web application still has a defensive profile-repair path in `utils/useSupabase.js`: if the signup trigger did not produce a profile, the authenticated user can recreate only their own row and keep their own email in sync.

RLS prevents that fallback from creating or updating another user's profile.

## CI change

CI no longer pre-creates `public."user"` before migrations.

This is important: the PostgreSQL job now proves that the migration itself owns the baseline.

Local Supabase MCP/Realtime jobs also stop bootstrapping the table after startup. Their auth signup/admin-create flows exercise the real `on_auth_user_created` trigger.

Tests that used to insert a profile manually after creating an Auth user now update/upsert the trigger-created row.

## Exit criterion

A fresh database containing only Supabase-compatible `auth.users`/roles can apply PR-02 without a legacy schema bootstrap, and:

- signup creates a profile;
- A reads/updates A;
- A cannot read/update B;
- self repair insert works;
- cross-user insert fails;
- anonymous profile reads fail;
- all existing private-chat/MCP/Realtime security tests remain green.
