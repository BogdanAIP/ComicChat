-- ComicChat PR-15: authenticated self-service data export.
-- The export is assembled at the trusted RPC boundary from data the caller owns
-- or is already authorized to read as a conversation member. Internal worker
-- lease tokens and Supabase/OAuth authentication metadata are intentionally omitted.

CREATE OR REPLACE FUNCTION public.comic_export_my_data()
RETURNS JSONB
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

    RETURN pg_catalog.jsonb_build_object(
        'schema_version', 1,
        'exported_at', CURRENT_TIMESTAMP,
        'profile',
            COALESCE(
                (
                    SELECT pg_catalog.jsonb_build_object(
                        'id', u.id,
                        'username', u.username,
                        'email', u.email,
                        'created_at', u.created_at
                    )
                    FROM public."user" AS u
                    WHERE u.id = me
                ),
                pg_catalog.jsonb_build_object('id', me)
            ),
        'memberships',
            COALESCE(
                (
                    SELECT pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'conversation_id', m.conversation_id,
                            'role', m.role,
                            'joined_at', m.joined_at
                        )
                        ORDER BY m.joined_at, m.conversation_id
                    )
                    FROM public.comic_membership AS m
                    WHERE m.user_id = me
                ),
                '[]'::JSONB
            ),
        'participants',
            COALESCE(
                (
                    SELECT pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'conversation_id', p.conversation_id,
                            'user_id', p.user_id,
                            'username', u.username,
                            'role', p.role,
                            'joined_at', p.joined_at
                        )
                        ORDER BY p.conversation_id, p.joined_at, p.user_id
                    )
                    FROM public.comic_membership AS mine
                    JOIN public.comic_membership AS p
                      ON p.conversation_id = mine.conversation_id
                    LEFT JOIN public."user" AS u
                      ON u.id = p.user_id
                    WHERE mine.user_id = me
                ),
                '[]'::JSONB
            ),
        'conversations',
            COALESCE(
                (
                    SELECT pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'id', c.id,
                            'kind', c.kind,
                            'created_by', c.created_by,
                            'created_at', c.created_at,
                            'updated_at', c.updated_at
                        )
                        ORDER BY c.created_at, c.id
                    )
                    FROM public.comic_conversation AS c
                    JOIN public.comic_membership AS mine
                      ON mine.conversation_id = c.id
                     AND mine.user_id = me
                ),
                '[]'::JSONB
            ),
        'messages',
            COALESCE(
                (
                    SELECT pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'id', m.id,
                            'conversation_id', m.conversation_id,
                            'sender_id', m.sender_id,
                            'client_nonce', m.client_nonce,
                            'original_text', m.original_text,
                            'status', m.status,
                            'created_at', m.created_at,
                            'updated_at', m.updated_at
                        )
                        ORDER BY m.created_at, m.id
                    )
                    FROM public.comic_message AS m
                    WHERE EXISTS (
                        SELECT 1
                        FROM public.comic_membership AS mine
                        WHERE mine.conversation_id = m.conversation_id
                          AND mine.user_id = me
                    )
                ),
                '[]'::JSONB
            ),
        'receipts',
            COALESCE(
                (
                    SELECT pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'message_id', r.message_id,
                            'conversation_id', r.conversation_id,
                            'delivered_at', r.delivered_at,
                            'read_at', r.read_at
                        )
                        ORDER BY r.conversation_id, r.message_id
                    )
                    FROM public.comic_message_receipt AS r
                    WHERE r.user_id = me
                ),
                '[]'::JSONB
            ),
        'blocks_created',
            COALESCE(
                (
                    SELECT pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'blocked_user_id', b.blocked_id,
                            'username', u.username,
                            'created_at', b.created_at
                        )
                        ORDER BY b.created_at, b.blocked_id
                    )
                    FROM public.comic_user_block AS b
                    LEFT JOIN public."user" AS u
                      ON u.id = b.blocked_id
                    WHERE b.blocker_id = me
                ),
                '[]'::JSONB
            ),
        'reports_submitted',
            COALESCE(
                (
                    SELECT pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'id', r.id,
                            'message_id', r.message_id,
                            'conversation_id', r.conversation_id,
                            'reported_user_id', r.reported_user_id,
                            'reason', r.reason,
                            'details', r.details,
                            'status', r.status,
                            'created_at', r.created_at,
                            'updated_at', r.updated_at
                        )
                        ORDER BY r.created_at, r.id
                    )
                    FROM public.comic_abuse_report AS r
                    WHERE r.reporter_id = me
                ),
                '[]'::JSONB
            ),
        'generation_jobs',
            COALESCE(
                (
                    SELECT pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'id', j.id,
                            'message_id', j.message_id,
                            'conversation_id', j.conversation_id,
                            'provider', j.provider,
                            'billing_source', j.billing_source,
                            'status', j.status,
                            'attempt_count', j.attempt_count,
                            'max_attempts', j.max_attempts,
                            'output_descriptor', j.output_descriptor,
                            'error_code', j.error_code,
                            'created_at', j.created_at,
                            'updated_at', j.updated_at,
                            'completed_at', j.completed_at
                        )
                        ORDER BY j.created_at, j.id
                    )
                    FROM public.comic_generation_job AS j
                    WHERE j.sender_id = me
                ),
                '[]'::JSONB
            ),
        'usage_ledger',
            COALESCE(
                (
                    SELECT pg_catalog.jsonb_agg(
                        pg_catalog.jsonb_build_object(
                            'id', l.id,
                            'job_id', l.job_id,
                            'message_id', l.message_id,
                            'provider', l.provider,
                            'billing_source', l.billing_source,
                            'attempt_no', l.attempt_no,
                            'event_type', l.event_type,
                            'billable_units', l.billable_units,
                            'cost_microunits', l.cost_microunits,
                            'metadata', l.metadata,
                            'recorded_at', l.recorded_at
                        )
                        ORDER BY l.recorded_at, l.id
                    )
                    FROM public.comic_usage_ledger AS l
                    WHERE l.sender_id = me
                ),
                '[]'::JSONB
            )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.comic_export_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_export_my_data() TO authenticated;
