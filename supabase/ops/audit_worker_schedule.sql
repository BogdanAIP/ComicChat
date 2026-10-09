-- Hosted Supabase provisioning, applied separately from the portable schema.
-- Reuses pg_cron + pg_net + Vault. Does not enable or change an image provider.
-- Run only after comicchat-worker has been deployed and auth-smoke checked.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='comicchat_worker_token') THEN
    PERFORM vault.create_secret(
      pg_catalog.encode(extensions.gen_random_bytes(32),'hex'),
      'comicchat_worker_token','Dedicated ComicChat queue drain credential'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_validate_worker_secret(p_secret TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT pg_catalog.length(p_secret) BETWEEN 32 AND 512 AND EXISTS(
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name='comicchat_worker_token' AND decrypted_secret=p_secret
  );
$$;
REVOKE ALL ON FUNCTION public.comic_validate_worker_secret(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.comic_validate_worker_secret(TEXT) TO service_role;

-- Vault values are resolved inside the database; no credential is embedded in
-- the cron command, repository, browser, logs, or returned SQL result.
SELECT cron.schedule('comicchat-generation-drain','* * * * *',
  $cron$
  SELECT net.http_post(
    url:='https://qbqfxuijnispicvazmgj.supabase.co/functions/v1/comicchat-worker',
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name='comicchat_worker_token')),
    body:='{}'::JSONB,timeout_milliseconds:=10000
  );
  $cron$);
