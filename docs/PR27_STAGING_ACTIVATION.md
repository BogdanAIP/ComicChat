# PR-27 — staging activation harness

Date: 2026-10-08  
Base: `main@865917ad12a57dcdb6b56c45ac53bfad6ec0dc92`

## Goal

Turn ComicChat's existing production-preflight foundation into a repeatable **staging deployment path** without silently creating paid resources or enabling image generation.

The workflow remains manual and uses the official Supabase CLI:

```text
GitHub Environment: comicchat-staging
  -> supabase link
  -> supabase db push --dry-run
  -> optional supabase db push
  -> optional supabase functions deploy --use-api
  -> optional OPENAI_API_KEY secret configuration
  -> explicit provider enable/disable
  -> public MCP + render auth smoke
```

PR-27 does not deploy the Next.js frontend and does not claim ChatGPT Plugin acceptance. Those remain separate acceptance steps.

## Reuse decision

### Rakazo Market

Market Resolver did not contain a relevant Supabase/Vercel deployment resolver.

Market Skills returned the first-party `build-mcp-server` workflow, which reinforces a remote HTTP deployment model for the already-existing MCP server. That Skill is used as development guidance; it is not a ComicChat runtime dependency.

### Official platform tooling

PR-27 reuses Supabase's documented CLI rather than adding custom deployment infrastructure:

- `supabase link --project-ref`
- `supabase db push --dry-run`
- `supabase db push`
- `supabase functions deploy --use-api`
- `supabase secrets set`

Official references:

- https://supabase.com/docs/guides/functions/deploy
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/local-development/cli-workflows
- https://supabase.com/docs/reference/cli/global-flags

## GitHub Environment

Create a GitHub Environment named:

```text
comicchat-staging
```

Recommended: require a human approval on that Environment before deployment jobs can access its secrets.

Environment secrets:

- `SUPABASE_ACCESS_TOKEN` — required for plan/deploy.
- `SUPABASE_DB_PASSWORD` — required for linking and migration planning.
- `STAGING_SUPABASE_DB_URL` — required only when the workflow must explicitly enable or disable the image provider.
- `OPENAI_API_KEY` — required only when explicitly enabling external image generation.

These values are never workflow-dispatch inputs.

## Modes

### plan — default

The default run is intentionally non-mutating:

1. validates the project ref and required deployment credentials;
2. links the local CLI context to staging;
3. runs `supabase db push --dry-run`;
4. writes a summary;
5. does **not** apply migrations;
6. does **not** deploy functions;
7. does **not** set OpenAI secrets;
8. does **not** alter provider state.

### deploy

`deploy` applies outstanding migrations and deploys all local Edge Functions using Supabase's API-based bundling/deployment path.

After deploy it reuses existing ComicChat acceptance probes:

- PR-08 MCP OAuth protected-resource smoke;
- PR-25 render unauthenticated/auth-boundary smoke.

This proves public HTTPS routing and the expected unauthenticated boundaries, not full two-account product acceptance.

## Image provider state

`image_provider_mode` has three choices:

- `leave-disabled` — default; does not alter the existing DB setting;
- `enable` — requires `OPENAI_API_KEY` + `STAGING_SUPABASE_DB_URL`, stores the OpenAI secret through Supabase, then explicitly enables `openai-image`;
- `disable` — requires `STAGING_SUPABASE_DB_URL` and explicitly switches external generation off.

Provider state changes are rejected in `plan` mode.

There is no implicit enable after deploy.

## Why the DB URL is a separate secret

The Supabase CLI can link and push migrations using the project ref/password, but ComicChat's provider on/off switch is application data in `public.comic_generation_config`.

PR-27 deliberately does not add a public/admin HTTP endpoint just to mutate this setting. A staging operator uses a privileged database connection stored only in the protected GitHub Environment.

## Existing key compatibility

ComicChat's current Edge Functions still read the legacy Supabase-provided environment variables `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.

Supabase currently provisions newer publishable/secret-key variables as well and recommends newer server context patterns. Migrating the Edge functions to that API is a separate modernization task; it is not required to block this staging deployment because Supabase continues to expose the legacy variables for compatibility.

## Exit criterion

PR-27 is complete when repository CI proves:

- the staging workflow is manual only;
- default mode is plan-only;
- default provider action is leave-disabled;
- no secret is accepted as a dispatch input;
- official Supabase CLI commands are reused;
- provider enable requires both OpenAI secret and staging DB URL;
- existing public MCP/render smoke scripts are reused;
- normal CI remains green.

Actual beta activation still requires configuring a real `comicchat-staging` Environment and running this workflow against a real Supabase project.
