-- ComicChat PR-05: transactional async generation queue and sender-attributed usage ledger.
-- No external image provider is enabled here. New jobs use the deterministic
-- mock provider boundary until a separately reviewed provider integration ships.

CREATE UNIQUE INDEX IF NOT EXISTS comic_message_identity_unique_idx
    ON public.comic_message(id, conversation_id, sender_id);

CREATE TABLE IF NOT EXISTS public.comic_generation_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL UNIQUE,
    conversation_id UUID NOT NULL,
    sender_id UUID NOT NULL,
    provider TEXT NOT NULL DEFAULT 'mock'
        CHECK (provider ~ '^[a-z][a-z0-9._-]{0,63}$'),
    billing_source TEXT NOT NULL DEFAULT 'mock'
        CHECK (billing_source ~ '^[a-z][a-z0-9._-]{0,63}$'),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    output_descriptor JSONB,
    error_code TEXT,
    error_detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT comic_generation_job_message_identity_fk
        FOREIGN KEY (message_id, conversation_id, sender_id)
        REFERENCES public.comic_message(id, conversation_id, sender_id)
        ON DELETE CASCADE,
    CONSTRAINT comic_generation_job_lease_check
        CHECK (
            (
                status = 'rendering'
                AND lease_token IS NOT NULL
                AND lease_expires_at IS NOT NULL
            )
            OR (
                status <> 'rendering'
                AND lease_token IS NULL
                AND lease_expires_at IS NULL
            )
        ),
    CONSTRAINT comic_generation_job_output_check
        CHECK (
            output_descriptor IS NULL
            OR jsonb_typeof(output_descriptor) = 'object'
        )
);

CREATE INDEX IF NOT EXISTS comic_generation_job_queue_idx
    ON public.comic_generation_job(provider, status, created_at, id);

CREATE INDEX IF NOT EXISTS comic_generation_job_sender_idx
    ON public.comic_generation_job(sender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.comic_usage_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.comic_generation_job(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES public.comic_message(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    billing_source TEXT NOT NULL,
    attempt_no INTEGER NOT NULL CHECK (attempt_no >= 0),
    event_type TEXT NOT NULL
        CHECK (event_type IN (
            'queued',
            'started',
            'failed',
            'retry_scheduled',
            'succeeded'
        )),
    billable_units BIGINT NOT NULL DEFAULT 0 CHECK (billable_units >= 0),
    cost_microunits BIGINT NOT NULL DEFAULT 0 CHECK (cost_microunits >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB
        CHECK (jsonb_typeof(metadata) = 'object'),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_id, attempt_no, event_type)
);

CREATE INDEX IF NOT EXISTS comic_usage_ledger_sender_idx
    ON public.comic_usage_ledger(sender_id, recorded_at DESC);

ALTER TABLE public.comic_generation_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_usage_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comic_generation_job_select_sender
    ON public.comic_generation_job;
CREATE POLICY comic_generation_job_select_sender
    ON public.comic_generation_job
    FOR SELECT
    TO authenticated
    USING (sender_id = auth.uid());

DROP POLICY IF EXISTS comic_usage_ledger_select_sender
    ON public.comic_usage_ledger;
CREATE POLICY comic_usage_ledger_select_sender
    ON public.comic_usage_ledger
    FOR SELECT
    TO authenticated
    USING (sender_id = auth.uid());

REVOKE ALL ON TABLE public.comic_generation_job FROM PUBLIC;
REVOKE ALL ON TABLE public.comic_generation_job FROM anon, authenticated, service_role;
REVOKE ALL ON TABLE public.comic_usage_ledger FROM PUBLIC;
REVOKE ALL ON TABLE public.comic_usage_ledger FROM anon, authenticated, service_role;

GRANT SELECT ON TABLE public.comic_generation_job TO authenticated;
GRANT SELECT ON TABLE public.comic_usage_ledger TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_enqueue_generation_for_message(
    p_message_id UUID,
    p_conversation_id UUID,
    p_sender_id UUID
)
RETURNS public.comic_generation_job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    queued_job public.comic_generation_job%ROWTYPE;
BEGIN
    INSERT INTO public.comic_generation_job(
        message_id,
        conversation_id,
        sender_id,
        provider,
        billing_source,
        status
    )
    VALUES (
        p_message_id,
        p_conversation_id,
        p_sender_id,
        'mock',
        'mock',
        'queued'
    )
    ON CONFLICT (message_id) DO NOTHING;

    SELECT *
    INTO queued_job
    FROM public.comic_generation_job AS j
    WHERE j.message_id = p_message_id;

    IF queued_job.id IS NULL
       OR queued_job.conversation_id IS DISTINCT FROM p_conversation_id
       OR queued_job.sender_id IS DISTINCT FROM p_sender_id THEN
        RAISE EXCEPTION 'generation_job_identity_conflict'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.comic_usage_ledger(
        job_id,
        message_id,
        sender_id,
        provider,
        billing_source,
        attempt_no,
        event_type,
        billable_units,
        cost_microunits,
        metadata
    )
    VALUES (
        queued_job.id,
        queued_job.message_id,
        queued_job.sender_id,
        queued_job.provider,
        queued_job.billing_source,
        0,
        'queued',
        0,
        0,
        '{"reason":"message_created"}'::JSONB
    )
    ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;

    RETURN queued_job;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_enqueue_generation_for_message(UUID, UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;

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

        PERFORM public.comic_enqueue_generation_for_message(
            existing_message.id,
            existing_message.conversation_id,
            existing_message.sender_id
        );

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

CREATE OR REPLACE FUNCTION public.comic_claim_generation_job(
    p_provider TEXT DEFAULT 'mock',
    p_lease_seconds INTEGER DEFAULT 60
)
RETURNS SETOF public.comic_generation_job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    now_utc TIMESTAMPTZ := NOW();
    lease_seconds INTEGER := LEAST(
        GREATEST(COALESCE(p_lease_seconds, 60), 5),
        900
    );
    exhausted public.comic_generation_job%ROWTYPE;
    candidate public.comic_generation_job%ROWTYPE;
    claimed public.comic_generation_job%ROWTYPE;
    new_lease UUID;
BEGIN
    IF COALESCE(p_provider, '') <> 'mock' THEN
        RAISE EXCEPTION 'provider_not_enabled' USING ERRCODE = '22023';
    END IF;

    FOR exhausted IN
        SELECT *
        FROM public.comic_generation_job AS j
        WHERE j.provider = p_provider
          AND j.status = 'rendering'
          AND j.lease_expires_at <= now_utc
          AND j.attempt_count >= j.max_attempts
        ORDER BY j.created_at, j.id
        FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE public.comic_generation_job
        SET
            status = 'failed',
            lease_token = NULL,
            lease_expires_at = NULL,
            error_code = 'lease_expired',
            error_detail = 'Worker lease expired after the final allowed attempt',
            updated_at = now_utc,
            completed_at = now_utc
        WHERE id = exhausted.id;

        UPDATE public.comic_message
        SET status = 'failed', updated_at = now_utc
        WHERE id = exhausted.message_id;

        INSERT INTO public.comic_usage_ledger(
            job_id,
            message_id,
            sender_id,
            provider,
            billing_source,
            attempt_no,
            event_type,
            metadata
        )
        VALUES (
            exhausted.id,
            exhausted.message_id,
            exhausted.sender_id,
            exhausted.provider,
            exhausted.billing_source,
            exhausted.attempt_count,
            'failed',
            pg_catalog.jsonb_build_object(
                'code', 'lease_expired',
                'retryable', FALSE
            )
        )
        ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;
    END LOOP;

    SELECT *
    INTO candidate
    FROM public.comic_generation_job AS j
    WHERE j.provider = p_provider
      AND j.attempt_count < j.max_attempts
      AND (
          j.status = 'queued'
          OR (
              j.status = 'rendering'
              AND j.lease_expires_at <= now_utc
          )
      )
    ORDER BY j.created_at, j.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF candidate.id IS NULL THEN
        RETURN;
    END IF;

    IF candidate.status = 'rendering' THEN
        INSERT INTO public.comic_usage_ledger(
            job_id,
            message_id,
            sender_id,
            provider,
            billing_source,
            attempt_no,
            event_type,
            metadata
        )
        VALUES (
            candidate.id,
            candidate.message_id,
            candidate.sender_id,
            candidate.provider,
            candidate.billing_source,
            candidate.attempt_count,
            'failed',
            pg_catalog.jsonb_build_object(
                'code', 'lease_expired',
                'retryable', TRUE
            )
        )
        ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;

        INSERT INTO public.comic_usage_ledger(
            job_id,
            message_id,
            sender_id,
            provider,
            billing_source,
            attempt_no,
            event_type,
            metadata
        )
        VALUES (
            candidate.id,
            candidate.message_id,
            candidate.sender_id,
            candidate.provider,
            candidate.billing_source,
            candidate.attempt_count,
            'retry_scheduled',
            '{"reason":"lease_expired"}'::JSONB
        )
        ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;
    END IF;

    new_lease := gen_random_uuid();

    UPDATE public.comic_generation_job
    SET
        status = 'rendering',
        attempt_count = candidate.attempt_count + 1,
        lease_token = new_lease,
        lease_expires_at = now_utc
            + pg_catalog.make_interval(secs => lease_seconds),
        output_descriptor = NULL,
        error_code = NULL,
        error_detail = NULL,
        updated_at = now_utc,
        completed_at = NULL
    WHERE id = candidate.id
    RETURNING * INTO claimed;

    UPDATE public.comic_message
    SET status = 'rendering', updated_at = now_utc
    WHERE id = claimed.message_id;

    INSERT INTO public.comic_usage_ledger(
        job_id,
        message_id,
        sender_id,
        provider,
        billing_source,
        attempt_no,
        event_type,
        metadata
    )
    VALUES (
        claimed.id,
        claimed.message_id,
        claimed.sender_id,
        claimed.provider,
        claimed.billing_source,
        claimed.attempt_count,
        'started',
        pg_catalog.jsonb_build_object(
            'lease_expires_at', claimed.lease_expires_at
        )
    )
    ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;

    RETURN NEXT claimed;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_claim_generation_job(TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comic_claim_generation_job(TEXT, INTEGER)
    TO service_role;

CREATE OR REPLACE FUNCTION public.comic_complete_generation_job(
    p_job_id UUID,
    p_lease_token UUID,
    p_output_descriptor JSONB,
    p_billable_units BIGINT DEFAULT 0,
    p_cost_microunits BIGINT DEFAULT 0
)
RETURNS public.comic_generation_job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    now_utc TIMESTAMPTZ := NOW();
    current_job public.comic_generation_job%ROWTYPE;
    completed public.comic_generation_job%ROWTYPE;
BEGIN
    IF p_output_descriptor IS NULL
       OR jsonb_typeof(p_output_descriptor) <> 'object' THEN
        RAISE EXCEPTION 'invalid_output_descriptor' USING ERRCODE = '22023';
    END IF;

    IF COALESCE(p_billable_units, -1) < 0
       OR COALESCE(p_cost_microunits, -1) < 0 THEN
        RAISE EXCEPTION 'invalid_usage_amount' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO current_job
    FROM public.comic_generation_job AS j
    WHERE j.id = p_job_id
    FOR UPDATE;

    IF current_job.id IS NULL THEN
        RAISE EXCEPTION 'generation_job_not_found' USING ERRCODE = '22023';
    END IF;

    IF current_job.status <> 'rendering'
       OR current_job.lease_token IS DISTINCT FROM p_lease_token
       OR current_job.lease_expires_at <= now_utc THEN
        RAISE EXCEPTION 'stale_generation_lease' USING ERRCODE = '40001';
    END IF;

    UPDATE public.comic_generation_job
    SET
        status = 'ready',
        lease_token = NULL,
        lease_expires_at = NULL,
        output_descriptor = p_output_descriptor,
        error_code = NULL,
        error_detail = NULL,
        updated_at = now_utc,
        completed_at = now_utc
    WHERE id = current_job.id
    RETURNING * INTO completed;

    UPDATE public.comic_message
    SET status = 'ready', updated_at = now_utc
    WHERE id = completed.message_id;

    INSERT INTO public.comic_usage_ledger(
        job_id,
        message_id,
        sender_id,
        provider,
        billing_source,
        attempt_no,
        event_type,
        billable_units,
        cost_microunits,
        metadata
    )
    VALUES (
        completed.id,
        completed.message_id,
        completed.sender_id,
        completed.provider,
        completed.billing_source,
        completed.attempt_count,
        'succeeded',
        p_billable_units,
        p_cost_microunits,
        '{"result":"ready"}'::JSONB
    )
    ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;

    RETURN completed;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_complete_generation_job(UUID, UUID, JSONB, BIGINT, BIGINT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comic_complete_generation_job(UUID, UUID, JSONB, BIGINT, BIGINT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.comic_fail_generation_job(
    p_job_id UUID,
    p_lease_token UUID,
    p_error_code TEXT,
    p_error_detail TEXT DEFAULT NULL,
    p_retryable BOOLEAN DEFAULT TRUE
)
RETURNS public.comic_generation_job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    now_utc TIMESTAMPTZ := NOW();
    current_job public.comic_generation_job%ROWTYPE;
    next_status TEXT;
    failed public.comic_generation_job%ROWTYPE;
BEGIN
    SELECT *
    INTO current_job
    FROM public.comic_generation_job AS j
    WHERE j.id = p_job_id
    FOR UPDATE;

    IF current_job.id IS NULL THEN
        RAISE EXCEPTION 'generation_job_not_found' USING ERRCODE = '22023';
    END IF;

    IF current_job.status <> 'rendering'
       OR current_job.lease_token IS DISTINCT FROM p_lease_token
       OR current_job.lease_expires_at <= now_utc THEN
        RAISE EXCEPTION 'stale_generation_lease' USING ERRCODE = '40001';
    END IF;

    IF COALESCE(p_retryable, FALSE)
       AND current_job.attempt_count < current_job.max_attempts THEN
        next_status := 'queued';
    ELSE
        next_status := 'failed';
    END IF;

    INSERT INTO public.comic_usage_ledger(
        job_id,
        message_id,
        sender_id,
        provider,
        billing_source,
        attempt_no,
        event_type,
        metadata
    )
    VALUES (
        current_job.id,
        current_job.message_id,
        current_job.sender_id,
        current_job.provider,
        current_job.billing_source,
        current_job.attempt_count,
        'failed',
        pg_catalog.jsonb_build_object(
            'code', COALESCE(NULLIF(p_error_code, ''), 'generation_failed'),
            'retryable', next_status = 'queued'
        )
    )
    ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;

    IF next_status = 'queued' THEN
        INSERT INTO public.comic_usage_ledger(
            job_id,
            message_id,
            sender_id,
            provider,
            billing_source,
            attempt_no,
            event_type,
            metadata
        )
        VALUES (
            current_job.id,
            current_job.message_id,
            current_job.sender_id,
            current_job.provider,
            current_job.billing_source,
            current_job.attempt_count,
            'retry_scheduled',
            '{"reason":"worker_failure"}'::JSONB
        )
        ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;
    END IF;

    UPDATE public.comic_generation_job
    SET
        status = next_status,
        lease_token = NULL,
        lease_expires_at = NULL,
        output_descriptor = NULL,
        error_code = COALESCE(NULLIF(p_error_code, ''), 'generation_failed'),
        error_detail = p_error_detail,
        updated_at = now_utc,
        completed_at = CASE
            WHEN next_status = 'failed' THEN now_utc
            ELSE NULL
        END
    WHERE id = current_job.id
    RETURNING * INTO failed;

    UPDATE public.comic_message
    SET status = next_status, updated_at = now_utc
    WHERE id = failed.message_id;

    RETURN failed;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_fail_generation_job(UUID, UUID, TEXT, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comic_fail_generation_job(UUID, UUID, TEXT, TEXT, BOOLEAN)
    TO service_role;
