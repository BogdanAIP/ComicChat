-- ComicChat PR-02: secure private chat domain
-- This migration creates a new ComicChat-specific authorization boundary.
-- The inherited direct_message/direct_message_thread tables remain untouched for
-- rollback/reference but are not used by the new ComicChat private-message flow.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.comic_conversation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kind TEXT NOT NULL DEFAULT 'direct' CHECK (kind = 'direct'),
    direct_pair_key TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.comic_membership (
    conversation_id UUID NOT NULL REFERENCES public.comic_conversation(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'owner')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.comic_message (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.comic_conversation(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    client_nonce TEXT NOT NULL CHECK (char_length(client_nonce) BETWEEN 8 AND 200),
    original_text TEXT NOT NULL CHECK (
        char_length(original_text) BETWEEN 1 AND 4000
        AND char_length(btrim(original_text)) > 0
    ),
    status TEXT NOT NULL DEFAULT 'ready'
        CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (conversation_id, sender_id, client_nonce)
);

-- Later renderer/billing PRs use these tables. PR-02 does not create jobs or charge anyone.
CREATE TABLE IF NOT EXISTS public.comic_character_profile (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    reference_storage_key TEXT,
    traits JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.comic_generation_job (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL UNIQUE REFERENCES public.comic_message(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL,
    billing_source TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.comic_asset (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL REFERENCES public.comic_message(id) ON DELETE CASCADE,
    variant TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    access_policy TEXT NOT NULL DEFAULT 'private' CHECK (access_policy = 'private'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (message_id, variant)
);

CREATE TABLE IF NOT EXISTS public.comic_usage_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    message_id UUID NOT NULL REFERENCES public.comic_message(id) ON DELETE CASCADE,
    render_job_id UUID NOT NULL UNIQUE REFERENCES public.comic_generation_job(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    billing_source TEXT NOT NULL,
    external_usage_ref TEXT,
    state TEXT NOT NULL CHECK (state IN ('pending', 'committed', 'failed', 'reversed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_comic_membership_user
    ON public.comic_membership(user_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_comic_message_conversation_created
    ON public.comic_message(conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_comic_message_sender_nonce
    ON public.comic_message(sender_id, client_nonce);

CREATE OR REPLACE FUNCTION public.comic_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at = timezone('utc', now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comic_conversation_touch_updated_at ON public.comic_conversation;
CREATE TRIGGER comic_conversation_touch_updated_at
BEFORE UPDATE ON public.comic_conversation
FOR EACH ROW EXECUTE FUNCTION public.comic_touch_updated_at();

DROP TRIGGER IF EXISTS comic_message_touch_updated_at ON public.comic_message;
CREATE TRIGGER comic_message_touch_updated_at
BEFORE UPDATE ON public.comic_message
FOR EACH ROW EXECUTE FUNCTION public.comic_touch_updated_at();

ALTER TABLE public.comic_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_character_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_generation_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_usage_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comic_conversation_select_member ON public.comic_conversation;
CREATE POLICY comic_conversation_select_member
ON public.comic_conversation
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.comic_membership m
        WHERE m.conversation_id = comic_conversation.id
          AND m.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS comic_membership_select_self ON public.comic_membership;
CREATE POLICY comic_membership_select_self
ON public.comic_membership
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS comic_message_select_member ON public.comic_message;
CREATE POLICY comic_message_select_member
ON public.comic_message
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.comic_membership m
        WHERE m.conversation_id = comic_message.conversation_id
          AND m.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS comic_character_select_owner ON public.comic_character_profile;
CREATE POLICY comic_character_select_owner
ON public.comic_character_profile
FOR SELECT TO authenticated
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS comic_generation_job_select_member ON public.comic_generation_job;
CREATE POLICY comic_generation_job_select_member
ON public.comic_generation_job
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.comic_message msg
        JOIN public.comic_membership m
          ON m.conversation_id = msg.conversation_id
        WHERE msg.id = comic_generation_job.message_id
          AND m.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS comic_asset_select_member ON public.comic_asset;
CREATE POLICY comic_asset_select_member
ON public.comic_asset
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.comic_message msg
        JOIN public.comic_membership m
          ON m.conversation_id = msg.conversation_id
        WHERE msg.id = comic_asset.message_id
          AND m.user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS comic_usage_ledger_select_sender ON public.comic_usage_ledger;
CREATE POLICY comic_usage_ledger_select_sender
ON public.comic_usage_ledger
FOR SELECT TO authenticated
USING (sender_id = auth.uid());

-- Direct table mutation is intentionally unavailable to browser clients.
REVOKE INSERT, UPDATE, DELETE ON public.comic_conversation FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.comic_membership FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.comic_message FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.comic_character_profile FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.comic_generation_job FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.comic_asset FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.comic_usage_ledger FROM anon, authenticated;

GRANT SELECT ON public.comic_conversation TO authenticated;
GRANT SELECT ON public.comic_membership TO authenticated;
GRANT SELECT ON public.comic_message TO authenticated;
GRANT SELECT ON public.comic_character_profile TO authenticated;
GRANT SELECT ON public.comic_generation_job TO authenticated;
GRANT SELECT ON public.comic_asset TO authenticated;
GRANT SELECT ON public.comic_usage_ledger TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_ensure_conversation(partner_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    me UUID := auth.uid();
    pair_key TEXT;
    conversation UUID;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
    END IF;
    IF partner_id IS NULL OR partner_id = me THEN
        RAISE EXCEPTION 'invalid conversation partner' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = partner_id) THEN
        RAISE EXCEPTION 'conversation partner not found' USING ERRCODE = '22023';
    END IF;

    pair_key := least(me::text, partner_id::text) || ':' || greatest(me::text, partner_id::text);

    INSERT INTO public.comic_conversation (direct_pair_key, created_by)
    VALUES (pair_key, me)
    ON CONFLICT (direct_pair_key) DO NOTHING
    RETURNING id INTO conversation;

    IF conversation IS NULL THEN
        SELECT c.id
        INTO conversation
        FROM public.comic_conversation c
        WHERE c.direct_pair_key = pair_key;
    END IF;

    INSERT INTO public.comic_membership (conversation_id, user_id, role)
    VALUES
        (conversation, me, 'owner'),
        (conversation, partner_id, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    RETURN conversation;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_list_conversations()
RETURNS TABLE (
    conversation_id UUID,
    other_user_id UUID,
    conversation_created_at TIMESTAMPTZ,
    last_message_content TEXT,
    last_message_time TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT
        c.id,
        other_member.user_id,
        c.created_at,
        last_message.original_text,
        COALESCE(last_message.created_at, c.created_at)
    FROM public.comic_membership mine
    JOIN public.comic_conversation c
      ON c.id = mine.conversation_id
    JOIN public.comic_membership other_member
      ON other_member.conversation_id = c.id
     AND other_member.user_id <> auth.uid()
    LEFT JOIN LATERAL (
        SELECT m.original_text, m.created_at
        FROM public.comic_message m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
    ) last_message ON true
    WHERE mine.user_id = auth.uid()
      AND c.kind = 'direct'
    ORDER BY COALESCE(last_message.created_at, c.created_at) DESC, c.id;
$$;

CREATE OR REPLACE FUNCTION public.comic_send_message(
    p_conversation_id UUID,
    p_client_nonce TEXT,
    p_original_text TEXT
)
RETURNS SETOF public.comic_message
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    me UUID := auth.uid();
    existing public.comic_message%ROWTYPE;
    inserted public.comic_message%ROWTYPE;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
    END IF;
    IF p_client_nonce IS NULL OR char_length(p_client_nonce) NOT BETWEEN 8 AND 200 THEN
        RAISE EXCEPTION 'invalid client nonce' USING ERRCODE = '22023';
    END IF;
    IF p_original_text IS NULL
       OR char_length(p_original_text) > 4000
       OR char_length(btrim(p_original_text)) = 0 THEN
        RAISE EXCEPTION 'invalid message text' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.comic_membership m
        WHERE m.conversation_id = p_conversation_id
          AND m.user_id = me
    ) THEN
        RAISE EXCEPTION 'conversation access denied' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.comic_message (
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
        'ready'
    )
    ON CONFLICT (conversation_id, sender_id, client_nonce) DO NOTHING
    RETURNING * INTO inserted;

    IF inserted.id IS NOT NULL THEN
        RETURN NEXT inserted;
        RETURN;
    END IF;

    SELECT *
    INTO existing
    FROM public.comic_message m
    WHERE m.conversation_id = p_conversation_id
      AND m.sender_id = me
      AND m.client_nonce = p_client_nonce;

    IF existing.original_text IS DISTINCT FROM p_original_text THEN
        RAISE EXCEPTION 'idempotency conflict' USING ERRCODE = '23505';
    END IF;

    RETURN NEXT existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_mark_messages_delivered(p_message_ids UUID[])
RETURNS SETOF public.comic_message
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    me UUID := auth.uid();
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
    END IF;

    RETURN QUERY
    UPDATE public.comic_message msg
    SET delivered_at = COALESCE(msg.delivered_at, timezone('utc', now()))
    WHERE msg.id = ANY(COALESCE(p_message_ids, ARRAY[]::UUID[]))
      AND msg.sender_id <> me
      AND EXISTS (
          SELECT 1
          FROM public.comic_membership m
          WHERE m.conversation_id = msg.conversation_id
            AND m.user_id = me
      )
    RETURNING msg.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_mark_messages_read(p_message_ids UUID[])
RETURNS SETOF public.comic_message
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    me UUID := auth.uid();
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
    END IF;

    RETURN QUERY
    UPDATE public.comic_message msg
    SET
        delivered_at = COALESCE(msg.delivered_at, timezone('utc', now())),
        read_at = COALESCE(msg.read_at, timezone('utc', now()))
    WHERE msg.id = ANY(COALESCE(p_message_ids, ARRAY[]::UUID[]))
      AND msg.sender_id <> me
      AND EXISTS (
          SELECT 1
          FROM public.comic_membership m
          WHERE m.conversation_id = msg.conversation_id
            AND m.user_id = me
      )
    RETURNING msg.*;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_ensure_conversation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comic_list_conversations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comic_send_message(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comic_mark_messages_delivered(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comic_mark_messages_read(UUID[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.comic_ensure_conversation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comic_list_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.comic_send_message(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comic_mark_messages_delivered(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comic_mark_messages_read(UUID[]) TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'comic_message'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.comic_message;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'comic_membership'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.comic_membership;
    END IF;
END $$;

COMMENT ON TABLE public.comic_message IS
'ComicChat private messages. PR-02 uses status=ready until the PR-03/PR-05 render pipeline starts queued jobs.';
COMMENT ON COLUMN public.comic_asset.storage_key IS
'Private object-store key only. Do not store public or signed URLs here.';
