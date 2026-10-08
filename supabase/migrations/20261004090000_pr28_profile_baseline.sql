-- ComicChat PR-28: minimal fresh-project profile baseline.
--
-- This is the only legacy-upstream table required by the protected ComicChat
-- path. Public rooms, legacy direct messages and public chat-file storage are
-- intentionally not recreated here.

CREATE TABLE IF NOT EXISTS public."user" (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public."user" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."user" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public."user" TO authenticated;

DROP POLICY IF EXISTS comic_profile_select_self ON public."user";
CREATE POLICY comic_profile_select_self
    ON public."user"
    FOR SELECT
    TO authenticated
    USING (id = auth.uid());

DROP POLICY IF EXISTS comic_profile_insert_self ON public."user";
CREATE POLICY comic_profile_insert_self
    ON public."user"
    FOR INSERT
    TO authenticated
    WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS comic_profile_update_self ON public."user";
CREATE POLICY comic_profile_update_self
    ON public."user"
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.comic_touch_profile_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_touch_profile_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS comic_profile_touch_updated_at ON public."user";
CREATE TRIGGER comic_profile_touch_updated_at
BEFORE UPDATE ON public."user"
FOR EACH ROW
EXECUTE FUNCTION public.comic_touch_profile_updated_at();

CREATE OR REPLACE FUNCTION public.comic_create_profile_for_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    INSERT INTO public."user"(id, username, email)
    VALUES (NEW.id, NULL, NEW.email)
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_create_profile_for_auth_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS comic_auth_user_profile_insert ON auth.users;
CREATE TRIGGER comic_auth_user_profile_insert
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.comic_create_profile_for_auth_user();

COMMENT ON TABLE public."user" IS
    'Minimal ComicChat profile directory. Protected chat discovery uses SECURITY DEFINER RPCs; direct browser access is self-only.';
