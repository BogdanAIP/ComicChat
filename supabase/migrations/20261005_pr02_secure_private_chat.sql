-- ComicChat PR-02: secure private chat domain
-- This migration creates a new private-message path instead of weakening or
-- silently reusing the inherited direct_message* authorization model.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.comic_conversation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kind TEXT NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'group')),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    direct_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT comic_conversation_direct_key_check
        CHECK (
            (kind = 'direct' AND direct_key IS NOT NULL)
            OR (kind = 'group' AND direct_key IS NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS comic_conversation_direct_key_unique
    ON public.comic_conversation(direct_key)
    WHERE direct_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.comic_membership (
    conversation_id UUID NOT NULL REFERENCES public.comic_conversation(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS comic_membership_user_id_idx
    ON public.comic_membership(user_id, conversation_id);

CREATE TABLE IF NOT EXISTS public.comic_message (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.comic_conversation(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_nonce UUID NOT NULL,
    original_text TEXT NOT NULL CHECK (
        CHAR_LENGTH(original_text) > 0
        AND CHAR_LENGTH(original_text) <= 4000
    ),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    UNIQUE (conversation_id, sender_id, client_nonce),
    UNIQUE (id, conversation_id)
);

CREATE INDEX IF NOT EXISTS comic_message_conversation_order_idx
    ON public.comic_message(conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS public.comic_message_receipt (
    message_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    PRIMARY KEY (message_id, user_id),
    CONSTRAINT comic_message_receipt_message_fk
        FOREIGN KEY (message_id, conversation_id)
        REFERENCES public.comic_message(id, conversation_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS comic_message_receipt_user_idx
    ON public.comic_message_receipt(user_id, conversation_id, read_at);

ALTER TABLE public.comic_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_message_receipt ENABLE ROW LEVEL SECURITY;

-- Never trust a caller-supplied user id for authorization. Every helper below
-- derives identity from auth.uid() and fixes search_path for SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.comic_is_member(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.comic_membership AS m
        WHERE m.conversation_id = p_conversation_id
          AND m.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.comic_is_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_is_member(UUID) TO authenticated;

DROP POLICY IF EXISTS comic_conversation_select ON public.comic_conversation;
CREATE POLICY comic_conversation_select
    ON public.comic_conversation
    FOR SELECT
    TO authenticated
    USING (public.comic_is_member(id));

-- Membership rows are intentionally not exposed directly to the browser.
-- Participant discovery is provided by narrowly scoped RPCs below.

DROP POLICY IF EXISTS comic_message_select ON public.comic_message;
CREATE POLICY comic_message_select
    ON public.comic_message
    FOR SELECT
    TO authenticated
    USING (public.comic_is_member(conversation_id));

DROP POLICY IF EXISTS comic_message_receipt_select ON public.comic_message_receipt;
CREATE POLICY comic_message_receipt_select
    ON public.comic_message_receipt
    FOR SELECT
    TO authenticated
    USING (public.comic_is_member(conversation_id));

REVOKE ALL ON TABLE public.comic_conversation FROM anon, authenticated;
REVOKE ALL ON TABLE public.comic_membership FROM anon, authenticated;
REVOKE ALL ON TABLE public.comic_message FROM anon, authenticated;
REVOKE ALL ON TABLE public.comic_message_receipt FROM anon, authenticated;

GRANT SELECT ON TABLE public.comic_conversation TO authenticated;
GRANT SELECT ON TABLE public.comic_message TO authenticated;
GRANT SELECT ON TABLE public.comic_message_receipt TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_ensure_direct_conversation(partner_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    pair_key TEXT;
    conversation_id UUID;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    IF partner_id IS NULL OR partner_id = me THEN
        RAISE EXCEPTION 'invalid_partner' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = partner_id) THEN
        RAISE EXCEPTION 'partner_not_found' USING ERRCODE = '22023';
    END IF;

    pair_key := LEAST(me::TEXT, partner_id::TEXT)
        || ':'
        || GREATEST(me::TEXT, partner_id::TEXT);

    INSERT INTO public.comic_conversation(kind, created_by, direct_key)
    VALUES ('direct', me, pair_key)
    ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL
    DO UPDATE SET direct_key = EXCLUDED.direct_key
    RETURNING id INTO conversation_id;

    INSERT INTO public.comic_membership(conversation_id, user_id, role)
    VALUES
        (conversation_id, me, 'member'),
        (conversation_id, partner_id, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    RETURN conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_ensure_direct_conversation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_ensure_direct_conversation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_search_users(p_query TEXT)
RETURNS TABLE (
    user_id UUID,
    username TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    q TEXT := BTRIM(COALESCE(p_query, ''));
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    IF CHAR_LENGTH(q) < 2 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT u.id, u.username
    FROM public."user" AS u
    WHERE u.id <> me
      AND u.username IS NOT NULL
      AND POSITION(LOWER(q) IN LOWER(u.username)) > 0
    ORDER BY u.username
    LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_search_users(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_search_users(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_list_direct_conversations()
RETURNS TABLE (
    conversation_id UUID,
    other_user_id UUID,
    other_username TEXT,
    last_message_text TEXT,
    last_message_status TEXT,
    last_message_time TIMESTAMPTZ,
    unread_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        c.id AS conversation_id,
        other_m.user_id AS other_user_id,
        u.username AS other_username,
        last_m.original_text AS last_message_text,
        last_m.status AS last_message_status,
        COALESCE(last_m.created_at, c.created_at) AS last_message_time,
        (
            SELECT COUNT(*)
            FROM public.comic_message_receipt AS r
            WHERE r.conversation_id = c.id
              AND r.user_id = me
              AND r.read_at IS NULL
        ) AS unread_count
    FROM public.comic_conversation AS c
    JOIN public.comic_membership AS mine
      ON mine.conversation_id = c.id
     AND mine.user_id = me
    JOIN public.comic_membership AS other_m
      ON other_m.conversation_id = c.id
     AND other_m.user_id <> me
    LEFT JOIN public."user" AS u
      ON u.id = other_m.user_id
    LEFT JOIN LATERAL (
        SELECT m.original_text, m.status, m.created_at
        FROM public.comic_message AS m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
    ) AS last_m ON TRUE
    WHERE c.kind = 'direct'
    ORDER BY COALESCE(last_m.created_at, c.created_at) DESC, c.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_list_direct_conversations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_list_direct_conversations() TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_send_message(
    p_conversation_id UUID,
    p_client_nonce UUID,
    p_original_text TEXT
)
RETURNS SETOF public.comic_message
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    existing_message public.comic_message%ROWTYPE;
    created_message public.comic_message%ROWTYPE;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    IF p_client_nonce IS NULL THEN
        RAISE EXCEPTION 'client_nonce_required' USING ERRCODE = '22023';
    END IF;

    IF p_original_text IS NULL
       OR CHAR_LENGTH(BTRIM(p_original_text)) = 0
       OR CHAR_LENGTH(p_original_text) > 4000 THEN
        RAISE EXCEPTION 'invalid_message_text' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.comic_membership AS m
        WHERE m.conversation_id = p_conversation_id
          AND m.user_id = me
    ) THEN
        RAISE EXCEPTION 'conversation_forbidden' USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO existing_message
    FROM public.comic_message AS m
    WHERE m.conversation_id = p_conversation_id
      AND m.sender_id = me
      AND m.client_nonce = p_client_nonce;

    IF FOUND THEN
        IF existing_message.original_text IS DISTINCT FROM p_original_text THEN
            RAISE EXCEPTION 'client_nonce_conflict' USING ERRCODE = '23505';
        END IF;
        RETURN NEXT existing_message;
        RETURN;
    END IF;

    INSERT INTO public.comic_message(
        conversation_id,
        sender_id,
        client_nonce,
        original_text,
        status
    )
    VALUES (
        p_conversation_id,
        me,
        p_client_nonce,
        p_original_text,
        'queued'
    )
    ON CONFLICT (conversation_id, sender_id, client_nonce) DO NOTHING
    RETURNING * INTO created_message;

    IF created_message.id IS NULL THEN
        SELECT *
        INTO existing_message
        FROM public.comic_message AS m
        WHERE m.conversation_id = p_conversation_id
          AND m.sender_id = me
          AND m.client_nonce = p_client_nonce;

        IF existing_message.original_text IS DISTINCT FROM p_original_text THEN
            RAISE EXCEPTION 'client_nonce_conflict' USING ERRCODE = '23505';
        END IF;

        RETURN NEXT existing_message;
        RETURN;
    END IF;

    INSERT INTO public.comic_message_receipt(
        message_id,
        conversation_id,
        user_id
    )
    SELECT
        created_message.id,
        created_message.conversation_id,
        m.user_id
    FROM public.comic_membership AS m
    WHERE m.conversation_id = created_message.conversation_id
      AND m.user_id <> me
    ON CONFLICT (message_id, user_id) DO NOTHING;

    RETURN NEXT created_message;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_send_message(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_send_message(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_mark_conversation_delivered(p_conversation_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    affected INTEGER;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.comic_membership AS m
        WHERE m.conversation_id = p_conversation_id
          AND m.user_id = me
    ) THEN
        RAISE EXCEPTION 'conversation_forbidden' USING ERRCODE = '42501';
    END IF;

    UPDATE public.comic_message_receipt AS r
    SET delivered_at = COALESCE(r.delivered_at, TIMEZONE('utc', NOW()))
    WHERE r.conversation_id = p_conversation_id
      AND r.user_id = me
      AND r.delivered_at IS NULL;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_mark_conversation_delivered(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_mark_conversation_delivered(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_mark_conversation_read(p_conversation_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    affected INTEGER;
    now_utc TIMESTAMPTZ := TIMEZONE('utc', NOW());
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.comic_membership AS m
        WHERE m.conversation_id = p_conversation_id
          AND m.user_id = me
    ) THEN
        RAISE EXCEPTION 'conversation_forbidden' USING ERRCODE = '42501';
    END IF;

    UPDATE public.comic_message_receipt AS r
    SET
        delivered_at = COALESCE(r.delivered_at, now_utc),
        read_at = COALESCE(r.read_at, now_utc)
    WHERE r.conversation_id = p_conversation_id
      AND r.user_id = me
      AND r.read_at IS NULL;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_mark_conversation_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_mark_conversation_read(UUID) TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'comic_conversation'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.comic_conversation;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'comic_message'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.comic_message;
    END IF;
END $$;

-- PR-02 deliberately creates no media URL/file column. Attachments remain disabled
-- in the new ComicChat path until a private asset pipeline with signed access ships.
