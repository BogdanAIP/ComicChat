-- ComicChat PR-16: account-deletion request boundary.
-- This does not hard-delete an auth user. It introduces a reversible
-- deletion-request state, makes the account read-only for new chat interaction,
-- preserves shared history, and prevents raw auth-user deletion from cascading
-- through shared/audit records until a separately reviewed purge workflow exists.

CREATE TABLE IF NOT EXISTS public.comic_account_state (
    user_id UUID PRIMARY KEY
        REFERENCES auth.users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'deletion_requested')),
    deletion_requested_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT comic_account_state_requested_at_check
        CHECK (
            (status = 'active' AND deletion_requested_at IS NULL)
            OR
            (status = 'deletion_requested' AND deletion_requested_at IS NOT NULL)
        )
);

ALTER TABLE public.comic_account_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.comic_account_state FROM PUBLIC, anon, authenticated;

-- Defense in depth: raw deletion of an auth identity must not cascade away
-- shared conversation history, sender-attributed billing audit, or moderation
-- records before ComicChat has an explicit purge/anonymization transaction.
ALTER TABLE public.comic_membership
    DROP CONSTRAINT IF EXISTS comic_membership_auth_delete_guard_fk;
ALTER TABLE public.comic_membership
    ADD CONSTRAINT comic_membership_auth_delete_guard_fk
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.comic_message
    DROP CONSTRAINT IF EXISTS comic_message_auth_delete_guard_fk;
ALTER TABLE public.comic_message
    ADD CONSTRAINT comic_message_auth_delete_guard_fk
    FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.comic_usage_ledger
    DROP CONSTRAINT IF EXISTS comic_usage_auth_delete_guard_fk;
ALTER TABLE public.comic_usage_ledger
    ADD CONSTRAINT comic_usage_auth_delete_guard_fk
    FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.comic_abuse_report
    DROP CONSTRAINT IF EXISTS comic_reporter_auth_delete_guard_fk;
ALTER TABLE public.comic_abuse_report
    ADD CONSTRAINT comic_reporter_auth_delete_guard_fk
    FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.comic_abuse_report
    DROP CONSTRAINT IF EXISTS comic_reported_auth_delete_guard_fk;
ALTER TABLE public.comic_abuse_report
    ADD CONSTRAINT comic_reported_auth_delete_guard_fk
    FOREIGN KEY (reported_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.comic_account_interaction_allowed(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT NOT EXISTS (
        SELECT 1
        FROM public.comic_account_state AS s
        WHERE s.user_id = p_user_id
          AND s.status = 'deletion_requested'
    );
$$;

REVOKE ALL ON FUNCTION public.comic_account_interaction_allowed(UUID)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.comic_get_my_account_state()
RETURNS TABLE (
    status TEXT,
    deletion_requested_at TIMESTAMPTZ,
    hard_delete_enabled BOOLEAN
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
        COALESCE(s.status, 'active') AS status,
        s.deletion_requested_at,
        FALSE AS hard_delete_enabled
    FROM (SELECT 1) AS anchor
    LEFT JOIN public.comic_account_state AS s
      ON s.user_id = me;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_get_my_account_state()
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_get_my_account_state()
    TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_request_account_deletion()
RETURNS TABLE (
    status TEXT,
    deletion_requested_at TIMESTAMPTZ,
    hard_delete_enabled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    now_utc TIMESTAMPTZ := TIMEZONE('utc', NOW());
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.comic_account_state(
        user_id,
        status,
        deletion_requested_at,
        updated_at
    )
    VALUES (
        me,
        'deletion_requested',
        now_utc,
        now_utc
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
        status = 'deletion_requested',
        deletion_requested_at = COALESCE(
            public.comic_account_state.deletion_requested_at,
            EXCLUDED.deletion_requested_at
        ),
        updated_at = EXCLUDED.updated_at;

    RETURN QUERY
    SELECT
        s.status,
        s.deletion_requested_at,
        FALSE
    FROM public.comic_account_state AS s
    WHERE s.user_id = me;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_request_account_deletion()
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_request_account_deletion()
    TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_cancel_account_deletion()
RETURNS TABLE (
    status TEXT,
    deletion_requested_at TIMESTAMPTZ,
    hard_delete_enabled BOOLEAN
)
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

    DELETE FROM public.comic_account_state AS s
    WHERE s.user_id = me
      AND s.status = 'deletion_requested';

    RETURN QUERY
    SELECT
        'active'::TEXT,
        NULL::TIMESTAMPTZ,
        FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_cancel_account_deletion()
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_cancel_account_deletion()
    TO authenticated;

-- Override PR-11 search so deletion-requested accounts cannot initiate discovery
-- and cannot be discovered by active users.
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

    IF NOT public.comic_account_interaction_allowed(me) THEN
        RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
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
      AND public.comic_account_interaction_allowed(u.id)
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

-- Override PR-11 conversation opening. Existing history remains readable, but
-- a deletion-requested account cannot open/reopen an interactive direct thread.
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

    IF NOT public.comic_account_interaction_allowed(me) THEN
        RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
    END IF;

    IF partner_id IS NULL OR partner_id = me THEN
        RAISE EXCEPTION 'invalid_partner' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = partner_id) THEN
        RAISE EXCEPTION 'partner_not_found' USING ERRCODE = '22023';
    END IF;

    IF NOT public.comic_account_interaction_allowed(partner_id) THEN
        RAISE EXCEPTION 'account_unavailable' USING ERRCODE = '42501';
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

-- Preserve PR-14 atomic rate-limit/idempotency semantics. Exact retries remain
-- valid after either account requests deletion, but no generation job is
-- re-enqueued and genuinely new sends fail closed.
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
    sender_inactive BOOLEAN := FALSE;
    partner_inactive BOOLEAN := FALSE;
    recent_message_count BIGINT := 0;
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

    sender_inactive := NOT public.comic_account_interaction_allowed(me);

    SELECT EXISTS (
        SELECT 1
        FROM public.comic_conversation AS c
        JOIN public.comic_membership AS other_m
          ON other_m.conversation_id = c.id
         AND other_m.user_id <> me
        WHERE c.id = p_conversation_id
          AND c.kind = 'direct'
          AND NOT public.comic_account_interaction_allowed(other_m.user_id)
    )
    INTO partner_inactive;

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

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(me::TEXT, 0)
    );

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

        IF NOT interaction_blocked
           AND NOT sender_inactive
           AND NOT partner_inactive THEN
            PERFORM public.comic_enqueue_generation_for_message(
                existing_message.id,
                existing_message.conversation_id,
                existing_message.sender_id
            );
        END IF;

        RETURN NEXT existing_message;
        RETURN;
    END IF;

    IF sender_inactive THEN
        RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
    END IF;

    IF partner_inactive THEN
        RAISE EXCEPTION 'account_unavailable' USING ERRCODE = '42501';
    END IF;

    IF interaction_blocked THEN
        RAISE EXCEPTION 'interaction_blocked' USING ERRCODE = '42501';
    END IF;

    SELECT COUNT(*)
    INTO recent_message_count
    FROM public.comic_message AS m
    WHERE m.sender_id = me
      AND m.created_at > CURRENT_TIMESTAMP - INTERVAL '60 seconds';

    IF recent_message_count >= 30 THEN
        RAISE EXCEPTION 'send_rate_limited'
            USING
                ERRCODE = 'P0001',
                HINT = 'retry_after_seconds=60';
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

        IF NOT interaction_blocked
           AND NOT sender_inactive
           AND NOT partner_inactive THEN
            PERFORM public.comic_enqueue_generation_for_message(
                existing_message.id,
                existing_message.conversation_id,
                existing_message.sender_id
            );
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
