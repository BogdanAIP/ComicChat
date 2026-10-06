-- ComicChat PR-11: beta safety blocking boundary.
-- Blocking is enforced in the database so web and MCP clients cannot bypass it.
-- Existing history is preserved; blocked users cannot discover one another through
-- ComicChat search, open/reopen a direct conversation, or send new messages.

CREATE TABLE IF NOT EXISTS public.comic_user_block (
    blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT comic_user_block_not_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS comic_user_block_blocked_idx
    ON public.comic_user_block(blocked_id, blocker_id);

ALTER TABLE public.comic_user_block ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comic_user_block_select_own ON public.comic_user_block;
CREATE POLICY comic_user_block_select_own
    ON public.comic_user_block
    FOR SELECT
    TO authenticated
    USING (blocker_id = auth.uid());

REVOKE ALL ON TABLE public.comic_user_block FROM anon, authenticated;
GRANT SELECT ON TABLE public.comic_user_block TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_block_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL OR p_user_id = me THEN
        RAISE EXCEPTION 'invalid_block_target' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = p_user_id) THEN
        RAISE EXCEPTION 'user_not_found' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.comic_user_block(blocker_id, blocked_id)
    VALUES (me, p_user_id)
    ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_block_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_block_user(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_unblock_user(p_user_id UUID)
RETURNS BOOLEAN
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

    IF p_user_id IS NULL OR p_user_id = me THEN
        RAISE EXCEPTION 'invalid_block_target' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.comic_user_block AS b
    WHERE b.blocker_id = me
      AND b.blocked_id = p_user_id;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_unblock_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_unblock_user(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_list_blocked_users()
RETURNS TABLE (
    blocked_user_id UUID,
    username TEXT,
    blocked_at TIMESTAMPTZ
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
        b.blocked_id,
        u.username,
        b.created_at
    FROM public.comic_user_block AS b
    LEFT JOIN public."user" AS u
      ON u.id = b.blocked_id
    WHERE b.blocker_id = me
    ORDER BY b.created_at DESC, b.blocked_id;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_list_blocked_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_list_blocked_users() TO authenticated;

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
      AND NOT EXISTS (
          SELECT 1
          FROM public.comic_user_block AS b
          WHERE (b.blocker_id = me AND b.blocked_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_id = me)
      )
    ORDER BY u.username
    LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_search_users(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_search_users(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_ensure_direct_conversation(partner_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    pair_key TEXT;
    v_conversation_id UUID;
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

    IF EXISTS (
        SELECT 1
        FROM public.comic_user_block AS b
        WHERE (b.blocker_id = me AND b.blocked_id = partner_id)
           OR (b.blocker_id = partner_id AND b.blocked_id = me)
    ) THEN
        RAISE EXCEPTION 'interaction_blocked' USING ERRCODE = '42501';
    END IF;

    pair_key := LEAST(me::TEXT, partner_id::TEXT)
        || ':'
        || GREATEST(me::TEXT, partner_id::TEXT);

    INSERT INTO public.comic_conversation(kind, created_by, direct_key)
    VALUES ('direct', me, pair_key)
    ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL
    DO UPDATE SET direct_key = EXCLUDED.direct_key
    RETURNING id INTO v_conversation_id;

    INSERT INTO public.comic_membership(conversation_id, user_id, role)
    VALUES
        (v_conversation_id, me, 'member'),
        (v_conversation_id, partner_id, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    RETURN v_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_ensure_direct_conversation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_ensure_direct_conversation(UUID) TO authenticated;

-- Preserve the PR-05 transactional generation enqueue behavior while adding a
-- fail-closed interaction-block check before any retry/enqueue/insert occurs.
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
    interaction_blocked BOOLEAN := FALSE;
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

    SELECT EXISTS (
        SELECT 1
        FROM public.comic_conversation AS c
        JOIN public.comic_membership AS other_m
          ON other_m.conversation_id = c.id
         AND other_m.user_id <> me
        JOIN public.comic_user_block AS b
          ON (b.blocker_id = me AND b.blocked_id = other_m.user_id)
          OR (b.blocker_id = other_m.user_id AND b.blocked_id = me)
        WHERE c.id = p_conversation_id
          AND c.kind = 'direct'
    )
    INTO interaction_blocked;

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

        IF NOT interaction_blocked THEN
            PERFORM public.comic_enqueue_generation_for_message(
                existing_message.id,
                existing_message.conversation_id,
                existing_message.sender_id
            );
        END IF;

        RETURN NEXT existing_message;
        RETURN;
    END IF;

    IF interaction_blocked THEN
        RAISE EXCEPTION 'interaction_blocked' USING ERRCODE = '42501';
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

        PERFORM public.comic_enqueue_generation_for_message(
            existing_message.id,
            existing_message.conversation_id,
            existing_message.sender_id
        );

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

    PERFORM public.comic_enqueue_generation_for_message(
        created_message.id,
        created_message.conversation_id,
        created_message.sender_id
    );

    RETURN NEXT created_message;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_send_message(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_send_message(UUID, UUID, TEXT) TO authenticated;
