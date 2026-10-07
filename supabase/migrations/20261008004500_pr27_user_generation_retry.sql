-- ComicChat PR-27: sender-controlled retry of a failed generation.
--
-- Reuse-first: extend the existing GenerationJob + UsageLedger state machine.
-- No second queue, retry service or replacement message record is introduced.
--
-- A manual retry authorizes exactly one additional provider attempt and never
-- changes message_id, provider or billing_source. The hard total-attempt cap
-- remains bounded at 5 by the existing comic_generation_job constraint.

ALTER TABLE public.comic_usage_ledger
    ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS comic_usage_ledger_retry_request_id_idx
    ON public.comic_usage_ledger(job_id, request_id)
    WHERE event_type = 'retry_requested'
      AND request_id IS NOT NULL;

ALTER TABLE public.comic_usage_ledger
    DROP CONSTRAINT IF EXISTS comic_usage_ledger_event_type_check;

ALTER TABLE public.comic_usage_ledger
    ADD CONSTRAINT comic_usage_ledger_event_type_check
    CHECK (event_type IN (
        'queued',
        'started',
        'failed',
        'retry_scheduled',
        'retry_requested',
        'succeeded'
    ));

CREATE OR REPLACE FUNCTION public.comic_retry_failed_generation(
    p_message_id UUID,
    p_expected_attempt_no INTEGER,
    p_request_id UUID
)
RETURNS public.comic_generation_job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    current_job public.comic_generation_job%ROWTYPE;
    retried_job public.comic_generation_job%ROWTYPE;
    external_enabled BOOLEAN := FALSE;
    configured_provider TEXT;
    configured_billing_source TEXT;
    interaction_blocked BOOLEAN := FALSE;
    other_account_unavailable BOOLEAN := FALSE;
    next_attempt_cap INTEGER;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    IF p_message_id IS NULL
       OR p_expected_attempt_no IS NULL
       OR p_expected_attempt_no < 0
       OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'invalid_retry_request' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO current_job
    FROM public.comic_generation_job AS j
    WHERE j.message_id = p_message_id
      AND j.sender_id = me
    FOR UPDATE;

    IF current_job.id IS NULL THEN
        -- Keep foreign-existing and nonexistent message IDs externally
        -- indistinguishable for this sender-only action.
        RAISE EXCEPTION 'generation_job_not_found' USING ERRCODE = '42501';
    END IF;

    -- Stable cross-surface idempotency: once this request UUID was accepted
    -- for this job, replaying it is forever a no-op even after later attempts.
    IF EXISTS (
        SELECT 1
        FROM public.comic_usage_ledger AS l
        WHERE l.job_id = current_job.id
          AND l.event_type = 'retry_requested'
          AND l.request_id = p_request_id
    ) THEN
        RETURN current_job;
    END IF;

    -- A duplicate network request that arrives after the accepted retry has
    -- already moved the job forward must be a no-op, not another paid retry.
    IF current_job.status <> 'failed'
       OR current_job.attempt_count IS DISTINCT FROM p_expected_attempt_no THEN
        RETURN current_job;
    END IF;

    IF NOT public.comic_account_interaction_allowed(me) THEN
        RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.comic_membership AS other_m
        WHERE other_m.conversation_id = current_job.conversation_id
          AND other_m.user_id <> me
          AND NOT public.comic_account_interaction_allowed(other_m.user_id)
    )
    INTO other_account_unavailable;

    IF other_account_unavailable THEN
        RAISE EXCEPTION 'account_unavailable' USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.comic_membership AS other_m
        JOIN public.comic_user_block AS b
          ON (b.blocker_id = me AND b.blocked_id = other_m.user_id)
          OR (b.blocker_id = other_m.user_id AND b.blocked_id = me)
        WHERE other_m.conversation_id = current_job.conversation_id
          AND other_m.user_id <> me
    )
    INTO interaction_blocked;

    IF interaction_blocked THEN
        RAISE EXCEPTION 'interaction_blocked' USING ERRCODE = '42501';
    END IF;

    SELECT
        c.external_generation_enabled,
        c.provider,
        c.billing_source
    INTO
        external_enabled,
        configured_provider,
        configured_billing_source
    FROM public.comic_generation_config AS c
    WHERE c.singleton_id = 1;

    IF COALESCE(external_enabled, FALSE) IS FALSE
       OR configured_provider IS DISTINCT FROM current_job.provider
       OR configured_billing_source IS DISTINCT FROM current_job.billing_source THEN
        RAISE EXCEPTION 'generation_provider_not_enabled'
            USING ERRCODE = '55000';
    END IF;

    IF current_job.attempt_count >= 5 THEN
        RAISE EXCEPTION 'generation_retry_limit_reached'
            USING ERRCODE = '54000';
    END IF;

    -- One manual action == one additional provider attempt. If that attempt
    -- fails, it ends as failed again instead of silently consuming automatic
    -- retries. The user may explicitly request another retry up to attempt 5.
    next_attempt_cap := current_job.attempt_count + 1;

    INSERT INTO public.comic_usage_ledger(
        job_id,
        message_id,
        sender_id,
        provider,
        billing_source,
        attempt_no,
        event_type,
        request_id,
        billable_units,
        cost_microunits,
        metadata
    )
    VALUES (
        current_job.id,
        current_job.message_id,
        current_job.sender_id,
        current_job.provider,
        current_job.billing_source,
        current_job.attempt_count,
        'retry_requested',
        p_request_id,
        0,
        0,
        pg_catalog.jsonb_build_object(
            'reason', 'user_requested',
            'previous_error_code', current_job.error_code,
            'next_attempt', current_job.attempt_count + 1
        )
    )
    ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;

    UPDATE public.comic_generation_job
    SET
        status = 'queued',
        max_attempts = next_attempt_cap,
        lease_token = NULL,
        lease_expires_at = NULL,
        output_descriptor = NULL,
        error_code = NULL,
        error_detail = NULL,
        updated_at = NOW(),
        completed_at = NULL
    WHERE id = current_job.id
    RETURNING * INTO retried_job;

    UPDATE public.comic_message
    SET
        status = 'queued',
        updated_at = NOW()
    WHERE id = retried_job.message_id;

    RETURN retried_job;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_retry_failed_generation(UUID, INTEGER, UUID)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_retry_failed_generation(UUID, INTEGER, UUID)
    TO authenticated;
