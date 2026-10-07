-- ComicChat PR-20: snapshot-scoped bilateral consent for future public sharing.
-- No publication endpoint is introduced. Consent is bound to a specific
-- message cutoff and active requests are cancelled by safety-boundary changes.

CREATE TABLE IF NOT EXISTS public.comic_publication_request (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL
        REFERENCES public.comic_conversation(id) ON DELETE CASCADE,
    through_message_id UUID NOT NULL,
    requested_by UUID NOT NULL
        REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID
        REFERENCES auth.users(id) ON DELETE RESTRICT,
    CONSTRAINT comic_publication_request_snapshot_fk
        FOREIGN KEY (through_message_id, conversation_id)
        REFERENCES public.comic_message(id, conversation_id)
        ON DELETE CASCADE,
    CONSTRAINT comic_publication_request_cancel_check
        CHECK (
            (cancelled_at IS NULL AND cancelled_by IS NULL)
            OR
            (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS comic_publication_request_active_snapshot_unique
    ON public.comic_publication_request(conversation_id, through_message_id)
    WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS comic_publication_request_conversation_idx
    ON public.comic_publication_request(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.comic_publication_consent (
    request_id UUID NOT NULL
        REFERENCES public.comic_publication_request(id) ON DELETE CASCADE,
    user_id UUID NOT NULL
        REFERENCES auth.users(id) ON DELETE RESTRICT,
    consented_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    PRIMARY KEY (request_id, user_id)
);

CREATE INDEX IF NOT EXISTS comic_publication_consent_user_idx
    ON public.comic_publication_consent(user_id, consented_at DESC);

ALTER TABLE public.comic_publication_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_publication_consent ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.comic_publication_request
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.comic_publication_consent
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.comic_public_sharing_eligible(
    p_conversation_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT
        (SELECT COUNT(*) = 2
         FROM public.comic_membership AS m
         WHERE m.conversation_id = p_conversation_id)
        AND NOT EXISTS (
            SELECT 1
            FROM public.comic_membership AS m
            WHERE m.conversation_id = p_conversation_id
              AND NOT public.comic_account_interaction_allowed(m.user_id)
        )
        AND NOT EXISTS (
            SELECT 1
            FROM public.comic_user_block AS b
            JOIN public.comic_membership AS m1
              ON m1.conversation_id = p_conversation_id
             AND m1.user_id = b.blocker_id
            JOIN public.comic_membership AS m2
              ON m2.conversation_id = p_conversation_id
             AND m2.user_id = b.blocked_id
        );
$$;

REVOKE ALL ON FUNCTION public.comic_public_sharing_eligible(UUID)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.comic_propose_public_snapshot(
    p_conversation_id UUID,
    p_through_message_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    v_request_id UUID;
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

    IF NOT public.comic_account_interaction_allowed(me) THEN
        RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.comic_conversation AS c
        WHERE c.id = p_conversation_id
          AND c.kind = 'direct'
    ) THEN
        RAISE EXCEPTION 'sharing_not_supported' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.comic_message AS m
        WHERE m.id = p_through_message_id
          AND m.conversation_id = p_conversation_id
    ) THEN
        RAISE EXCEPTION 'snapshot_message_forbidden' USING ERRCODE = '42501';
    END IF;

    IF NOT public.comic_public_sharing_eligible(p_conversation_id) THEN
        RAISE EXCEPTION 'public_sharing_ineligible' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.comic_publication_request(
        conversation_id,
        through_message_id,
        requested_by
    )
    VALUES (
        p_conversation_id,
        p_through_message_id,
        me
    )
    ON CONFLICT (conversation_id, through_message_id)
        WHERE cancelled_at IS NULL
    DO UPDATE SET
        conversation_id = EXCLUDED.conversation_id
    RETURNING id INTO v_request_id;

    INSERT INTO public.comic_publication_consent(request_id, user_id)
    VALUES (v_request_id, me)
    ON CONFLICT (request_id, user_id) DO UPDATE
    SET consented_at = EXCLUDED.consented_at;

    RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_propose_public_snapshot(UUID, UUID)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_propose_public_snapshot(UUID, UUID)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_set_public_snapshot_consent(
    p_request_id UUID,
    p_consented BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
    conversation_id UUID;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    SELECT r.conversation_id
    INTO conversation_id
    FROM public.comic_publication_request AS r
    JOIN public.comic_membership AS membership
      ON membership.conversation_id = r.conversation_id
     AND membership.user_id = me
    WHERE r.id = p_request_id
      AND r.cancelled_at IS NULL;

    IF conversation_id IS NULL THEN
        RAISE EXCEPTION 'publication_request_forbidden' USING ERRCODE = '42501';
    END IF;

    IF COALESCE(p_consented, FALSE) THEN
        IF NOT public.comic_account_interaction_allowed(me) THEN
            RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
        END IF;

        IF NOT public.comic_public_sharing_eligible(conversation_id) THEN
            RAISE EXCEPTION 'public_sharing_ineligible' USING ERRCODE = '42501';
        END IF;

        INSERT INTO public.comic_publication_consent(request_id, user_id)
        VALUES (p_request_id, me)
        ON CONFLICT (request_id, user_id) DO UPDATE
        SET consented_at = EXCLUDED.consented_at;
    ELSE
        DELETE FROM public.comic_publication_consent AS c
        WHERE c.request_id = p_request_id
          AND c.user_id = me;
    END IF;

    RETURN COALESCE(p_consented, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.comic_set_public_snapshot_consent(UUID, BOOLEAN)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_set_public_snapshot_consent(UUID, BOOLEAN)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_cancel_public_snapshot_request(
    p_request_id UUID
)
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

    UPDATE public.comic_publication_request AS r
    SET
        cancelled_at = TIMEZONE('utc', NOW()),
        cancelled_by = me
    WHERE r.id = p_request_id
      AND r.cancelled_at IS NULL
      AND EXISTS (
          SELECT 1
          FROM public.comic_membership AS membership
          WHERE membership.conversation_id = r.conversation_id
            AND membership.user_id = me
      );

    GET DIAGNOSTICS affected = ROW_COUNT;

    IF affected = 0 THEN
        RAISE EXCEPTION 'publication_request_forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_cancel_public_snapshot_request(UUID)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_cancel_public_snapshot_request(UUID)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_list_public_snapshot_requests(
    p_conversation_id UUID
)
RETURNS TABLE (
    request_id UUID,
    through_message_id UUID,
    requested_by UUID,
    created_at TIMESTAMPTZ,
    my_consented BOOLEAN,
    consented_count INTEGER,
    member_count INTEGER,
    all_members_consented BOOLEAN,
    sharing_eligible BOOLEAN,
    publication_enabled BOOLEAN
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

    IF NOT EXISTS (
        SELECT 1
        FROM public.comic_membership AS m
        WHERE m.conversation_id = p_conversation_id
          AND m.user_id = me
    ) THEN
        RAISE EXCEPTION 'conversation_forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        r.id,
        r.through_message_id,
        r.requested_by,
        r.created_at,
        EXISTS (
            SELECT 1
            FROM public.comic_publication_consent AS mine
            WHERE mine.request_id = r.id
              AND mine.user_id = me
        ),
        (
            SELECT COUNT(*)::INTEGER
            FROM public.comic_publication_consent AS consent
            JOIN public.comic_membership AS member
              ON member.conversation_id = r.conversation_id
             AND member.user_id = consent.user_id
            WHERE consent.request_id = r.id
        ),
        (
            SELECT COUNT(*)::INTEGER
            FROM public.comic_membership AS member
            WHERE member.conversation_id = r.conversation_id
        ),
        (
            SELECT COUNT(*) > 0
               AND COUNT(*) = (
                   SELECT COUNT(*)
                   FROM public.comic_membership AS member
                   WHERE member.conversation_id = r.conversation_id
               )
            FROM public.comic_publication_consent AS consent
            JOIN public.comic_membership AS member
              ON member.conversation_id = r.conversation_id
             AND member.user_id = consent.user_id
            WHERE consent.request_id = r.id
        ),
        public.comic_public_sharing_eligible(r.conversation_id),
        FALSE
    FROM public.comic_publication_request AS r
    WHERE r.conversation_id = p_conversation_id
      AND r.cancelled_at IS NULL
    ORDER BY r.created_at DESC, r.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_list_public_snapshot_requests(UUID)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_list_public_snapshot_requests(UUID)
    TO authenticated;

-- Safety events permanently cancel active public-sharing proposals.
CREATE OR REPLACE FUNCTION public.comic_cancel_public_snapshots_on_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    UPDATE public.comic_publication_request AS r
    SET
        cancelled_at = TIMEZONE('utc', NOW()),
        cancelled_by = NEW.blocker_id
    WHERE r.cancelled_at IS NULL
      AND EXISTS (
          SELECT 1
          FROM public.comic_membership AS a
          JOIN public.comic_membership AS b
            ON b.conversation_id = a.conversation_id
          WHERE a.conversation_id = r.conversation_id
            AND a.user_id = NEW.blocker_id
            AND b.user_id = NEW.blocked_id
      );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comic_public_snapshot_cancel_on_block
    ON public.comic_user_block;
CREATE TRIGGER comic_public_snapshot_cancel_on_block
AFTER INSERT ON public.comic_user_block
FOR EACH ROW
EXECUTE FUNCTION public.comic_cancel_public_snapshots_on_block();

CREATE OR REPLACE FUNCTION public.comic_cancel_public_snapshots_on_deletion_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.status = 'deletion_requested' THEN
        UPDATE public.comic_publication_request AS r
        SET
            cancelled_at = TIMEZONE('utc', NOW()),
            cancelled_by = NEW.user_id
        WHERE r.cancelled_at IS NULL
          AND EXISTS (
              SELECT 1
              FROM public.comic_membership AS membership
              WHERE membership.conversation_id = r.conversation_id
                AND membership.user_id = NEW.user_id
          );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comic_public_snapshot_cancel_on_deletion_request
    ON public.comic_account_state;
CREATE TRIGGER comic_public_snapshot_cancel_on_deletion_request
AFTER INSERT OR UPDATE OF status ON public.comic_account_state
FOR EACH ROW
EXECUTE FUNCTION public.comic_cancel_public_snapshots_on_deletion_request();

CREATE OR REPLACE FUNCTION public.comic_cancel_public_snapshots_on_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    UPDATE public.comic_publication_request AS r
    SET
        cancelled_at = TIMEZONE('utc', NOW()),
        cancelled_by = OLD.user_id
    WHERE r.conversation_id = OLD.conversation_id
      AND r.cancelled_at IS NULL;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS comic_public_snapshot_cancel_on_membership_change
    ON public.comic_membership;
CREATE TRIGGER comic_public_snapshot_cancel_on_membership_change
AFTER DELETE ON public.comic_membership
FOR EACH ROW
EXECUTE FUNCTION public.comic_cancel_public_snapshots_on_membership_change();

REVOKE ALL ON FUNCTION public.comic_cancel_public_snapshots_on_block()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.comic_cancel_public_snapshots_on_deletion_request()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.comic_cancel_public_snapshots_on_membership_change()
    FROM PUBLIC, anon, authenticated, service_role;
