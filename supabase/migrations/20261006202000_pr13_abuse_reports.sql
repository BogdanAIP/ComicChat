-- ComicChat PR-13: private abuse-report boundary.
-- Reports are created only through authenticated RPCs. The reported user cannot
-- enumerate reports about themselves through the normal authenticated role.

CREATE TABLE IF NOT EXISTS public.comic_abuse_report (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL,
    message_id UUID NOT NULL,
    client_nonce UUID NOT NULL,
    reason TEXT NOT NULL CHECK (
        reason IN (
            'spam',
            'harassment',
            'threats',
            'sexual_content',
            'hate',
            'self_harm',
            'other'
        )
    ),
    details TEXT CHECK (details IS NULL OR CHAR_LENGTH(details) <= 1000),
    status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'reviewing', 'resolved', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT comic_abuse_report_message_identity_fk
        FOREIGN KEY (message_id, conversation_id, reported_user_id)
        REFERENCES public.comic_message(id, conversation_id, sender_id)
        ON DELETE CASCADE,
    CONSTRAINT comic_abuse_report_not_self
        CHECK (reporter_id <> reported_user_id),
    UNIQUE (reporter_id, client_nonce),
    UNIQUE (reporter_id, message_id)
);

CREATE INDEX IF NOT EXISTS comic_abuse_report_reported_idx
    ON public.comic_abuse_report(reported_user_id, created_at DESC);

ALTER TABLE public.comic_abuse_report ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comic_abuse_report_select_own ON public.comic_abuse_report;
CREATE POLICY comic_abuse_report_select_own
    ON public.comic_abuse_report
    FOR SELECT
    TO authenticated
    USING (reporter_id = auth.uid());

REVOKE ALL ON TABLE public.comic_abuse_report FROM anon, authenticated;
GRANT SELECT ON TABLE public.comic_abuse_report TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_report_message(
    p_message_id UUID,
    p_client_nonce UUID,
    p_reason TEXT,
    p_details TEXT DEFAULT NULL
)
RETURNS SETOF public.comic_abuse_report
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    normalized_reason TEXT := LOWER(BTRIM(COALESCE(p_reason, '')));
    normalized_details TEXT := NULLIF(BTRIM(COALESCE(p_details, '')), '');
    v_conversation_id UUID;
    v_reported_user_id UUID;
    existing_report public.comic_abuse_report%ROWTYPE;
    created_report public.comic_abuse_report%ROWTYPE;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    IF p_message_id IS NULL OR p_client_nonce IS NULL THEN
        RAISE EXCEPTION 'report_identity_required' USING ERRCODE = '22023';
    END IF;

    IF normalized_reason NOT IN (
        'spam',
        'harassment',
        'threats',
        'sexual_content',
        'hate',
        'self_harm',
        'other'
    ) THEN
        RAISE EXCEPTION 'invalid_report_reason' USING ERRCODE = '22023';
    END IF;

    IF normalized_details IS NOT NULL
       AND CHAR_LENGTH(normalized_details) > 1000 THEN
        RAISE EXCEPTION 'report_details_too_long' USING ERRCODE = '22023';
    END IF;

    -- Stable retry semantics: if this request UUID already succeeded, return
    -- exactly that report. A changed payload with the same UUID fails closed.
    SELECT *
    INTO existing_report
    FROM public.comic_abuse_report AS r
    WHERE r.reporter_id = me
      AND r.client_nonce = p_client_nonce;

    IF FOUND THEN
        IF existing_report.message_id IS DISTINCT FROM p_message_id
           OR existing_report.reason IS DISTINCT FROM normalized_reason
           OR existing_report.details IS DISTINCT FROM normalized_details THEN
            RAISE EXCEPTION 'report_nonce_conflict' USING ERRCODE = '23505';
        END IF;

        RETURN NEXT existing_report;
        RETURN;
    END IF;

    -- Do not reveal whether an arbitrary message UUID exists. The caller must
    -- be a current member of the conversation containing the target message.
    SELECT
        m.conversation_id,
        m.sender_id
    INTO
        v_conversation_id,
        v_reported_user_id
    FROM public.comic_message AS m
    JOIN public.comic_membership AS mine
      ON mine.conversation_id = m.conversation_id
     AND mine.user_id = me
    WHERE m.id = p_message_id;

    IF v_conversation_id IS NULL THEN
        RAISE EXCEPTION 'report_message_forbidden' USING ERRCODE = '42501';
    END IF;

    IF v_reported_user_id = me THEN
        RAISE EXCEPTION 'cannot_report_own_message' USING ERRCODE = '22023';
    END IF;

    -- One immutable user report per message is enough for the beta boundary.
    -- Repeating the action with a fresh nonce returns the first report instead
    -- of creating moderation spam.
    SELECT *
    INTO existing_report
    FROM public.comic_abuse_report AS r
    WHERE r.reporter_id = me
      AND r.message_id = p_message_id;

    IF FOUND THEN
        RETURN NEXT existing_report;
        RETURN;
    END IF;

    INSERT INTO public.comic_abuse_report(
        reporter_id,
        reported_user_id,
        conversation_id,
        message_id,
        client_nonce,
        reason,
        details
    )
    VALUES (
        me,
        v_reported_user_id,
        v_conversation_id,
        p_message_id,
        p_client_nonce,
        normalized_reason,
        normalized_details
    )
    ON CONFLICT DO NOTHING
    RETURNING * INTO created_report;

    IF created_report.id IS NOT NULL THEN
        RETURN NEXT created_report;
        RETURN;
    END IF;

    -- Concurrency-safe fallback for either unique boundary.
    SELECT *
    INTO existing_report
    FROM public.comic_abuse_report AS r
    WHERE r.reporter_id = me
      AND (
          r.client_nonce = p_client_nonce
          OR r.message_id = p_message_id
      )
    ORDER BY
        CASE WHEN r.client_nonce = p_client_nonce THEN 0 ELSE 1 END,
        r.created_at,
        r.id
    LIMIT 1;

    IF existing_report.id IS NULL THEN
        RAISE EXCEPTION 'report_insert_failed' USING ERRCODE = '40001';
    END IF;

    IF existing_report.client_nonce = p_client_nonce
       AND (
           existing_report.message_id IS DISTINCT FROM p_message_id
           OR existing_report.reason IS DISTINCT FROM normalized_reason
           OR existing_report.details IS DISTINCT FROM normalized_details
       ) THEN
        RAISE EXCEPTION 'report_nonce_conflict' USING ERRCODE = '23505';
    END IF;

    RETURN NEXT existing_report;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_report_message(UUID, UUID, TEXT, TEXT)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_report_message(UUID, UUID, TEXT, TEXT)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_list_my_reports()
RETURNS TABLE (
    report_id UUID,
    message_id UUID,
    conversation_id UUID,
    reported_user_id UUID,
    reason TEXT,
    details TEXT,
    status TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
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
        r.id,
        r.message_id,
        r.conversation_id,
        r.reported_user_id,
        r.reason,
        r.details,
        r.status,
        r.created_at,
        r.updated_at
    FROM public.comic_abuse_report AS r
    WHERE r.reporter_id = me
    ORDER BY r.created_at DESC, r.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_list_my_reports() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comic_list_my_reports() TO authenticated;
