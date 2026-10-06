-- ComicChat PR-14: closed-beta per-sender message rate limit.
-- Exact idempotent retries remain valid even after the sender reaches the window
-- limit. New sends are serialized per sender before counting/inserting.

CREATE INDEX IF NOT EXISTS comic_message_sender_created_idx
    ON public.comic_message(sender_id, created_at DESC);

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

    -- Authenticated clients cannot directly insert messages, so serializing
    -- comic_send_message per sender makes the count+insert limit atomic for
    -- untrusted clients without introducing a separate mutable counter.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(me::TEXT, 0)
    );

    -- Check idempotency only after acquiring the sender lock. Two concurrent
    -- retries using the same nonce therefore converge on the same row instead
    -- of letting the second request hit the rate limit.
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
