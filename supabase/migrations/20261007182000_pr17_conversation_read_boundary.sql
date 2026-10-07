-- ComicChat PR-17: explicit private conversation read boundary.
-- Web and MCP callers use one authenticated RPC instead of interpreting an
-- empty RLS-filtered query as either "no messages" or "not authorized".

CREATE OR REPLACE FUNCTION public.comic_read_conversation_messages(
    p_conversation_id UUID,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    id UUID,
    conversation_id UUID,
    sender_id UUID,
    client_nonce UUID,
    original_text TEXT,
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
    bounded_limit INTEGER;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    IF p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'conversation_forbidden' USING ERRCODE = '42501';
    END IF;

    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
        RAISE EXCEPTION 'invalid_message_limit' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.comic_membership AS membership
        WHERE membership.conversation_id = p_conversation_id
          AND membership.user_id = me
    ) THEN
        -- Deliberately identical for a foreign conversation and an unknown UUID:
        -- callers cannot distinguish existence from authorization failure.
        RAISE EXCEPTION 'conversation_forbidden' USING ERRCODE = '42501';
    END IF;

    bounded_limit := LEAST(p_limit, 1000);

    RETURN QUERY
    SELECT
        recent.id,
        recent.conversation_id,
        recent.sender_id,
        recent.client_nonce,
        recent.original_text,
        recent.status,
        recent.created_at,
        recent.updated_at
    FROM (
        SELECT
            m.id,
            m.conversation_id,
            m.sender_id,
            m.client_nonce,
            m.original_text,
            m.status,
            m.created_at,
            m.updated_at
        FROM public.comic_message AS m
        WHERE m.conversation_id = p_conversation_id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT bounded_limit
    ) AS recent
    ORDER BY recent.created_at ASC, recent.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_read_conversation_messages(UUID, INTEGER)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_read_conversation_messages(UUID, INTEGER)
    TO authenticated;
