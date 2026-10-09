-- Hosted legacy trigger from the original fork; not part of ComicChat's
-- portable bootstrap. Its verified body uses only pg_catalog builtins.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.handle_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.handle_updated_at() SET search_path=pg_catalog;
  END IF;
END;
$$;
