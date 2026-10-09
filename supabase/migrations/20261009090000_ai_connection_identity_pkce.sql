-- Optional external OAuth account linking only. No plan or image scopes.
-- All flow data and identities are service-only; browser never sees tokens/verifiers.
CREATE TABLE public.comic_ai_oauth_flow (
  state_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('chatgpt-account','codex-account')),
  code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_flow_verifier_valid CHECK (length(code_verifier) BETWEEN 43 AND 128)
);
CREATE TABLE public.comic_ai_account_link (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('chatgpt-account','codex-account')),
  provider_subject TEXT NOT NULL CHECK (length(provider_subject) BETWEEN 1 AND 512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, provider),
  UNIQUE (provider, provider_subject)
);
CREATE INDEX comic_ai_oauth_flow_expires_idx ON public.comic_ai_oauth_flow(expires_at);
ALTER TABLE public.comic_ai_oauth_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_ai_account_link ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comic_ai_oauth_flow FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.comic_ai_account_link FROM PUBLIC, anon, authenticated;
-- Routes use a verified Supabase bearer to establish current identity and service role
-- to create/consume one-time flow rows; no direct browser table access is granted.
GRANT SELECT, INSERT, DELETE ON public.comic_ai_oauth_flow TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comic_ai_account_link TO service_role;
