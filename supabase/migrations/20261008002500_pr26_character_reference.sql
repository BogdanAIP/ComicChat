-- ComicChat PR-26: conversation-scoped character reference continuity.
--
-- Reuse-first implementation:
-- - reuse OpenAI Images Edit with a prior private panel as the reference;
-- - do not create a custom identity model/reference-image service;
-- - scope the pinned reference to (sender, conversation) so visual context from
--   one private conversation never becomes a reference for another.
--
-- The source asset remains in the existing private comicchat-art bucket. This
-- table stores only domain IDs, never storage paths, URLs or provider locators.

CREATE TABLE IF NOT EXISTS public.comic_character_reference (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    conversation_id UUID NOT NULL,
    source_message_id UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, conversation_id),
    CONSTRAINT comic_character_reference_message_identity_fk
        FOREIGN KEY (source_message_id, conversation_id, user_id)
        REFERENCES public.comic_message(id, conversation_id, sender_id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS comic_character_reference_source_idx
    ON public.comic_character_reference(source_message_id);

ALTER TABLE public.comic_character_reference ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.comic_character_reference
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.comic_character_reference TO service_role;

-- Pin the first successful OpenAI-backed panel for this sender inside this
-- conversation. ON CONFLICT intentionally never replaces the pinned source.
CREATE OR REPLACE FUNCTION public.comic_pin_character_reference(
    p_message_id UUID
)
RETURNS public.comic_character_reference
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    source_message public.comic_message%ROWTYPE;
    source_job public.comic_generation_job%ROWTYPE;
    pinned public.comic_character_reference%ROWTYPE;
BEGIN
    SELECT *
    INTO source_message
    FROM public.comic_message AS m
    WHERE m.id = p_message_id;

    IF source_message.id IS NULL THEN
        RAISE EXCEPTION 'character_reference_source_not_found'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO source_job
    FROM public.comic_generation_job AS j
    WHERE j.message_id = source_message.id;

    IF source_job.id IS NULL
       OR source_job.status <> 'ready'
       OR source_job.provider <> 'openai-image'
       OR source_job.sender_id IS DISTINCT FROM source_message.sender_id
       OR source_job.conversation_id IS DISTINCT FROM source_message.conversation_id THEN
        RAISE EXCEPTION 'character_reference_source_not_ready'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.comic_character_reference(
        user_id,
        conversation_id,
        source_message_id
    )
    VALUES (
        source_message.sender_id,
        source_message.conversation_id,
        source_message.id
    )
    ON CONFLICT (user_id, conversation_id) DO NOTHING;

    SELECT *
    INTO pinned
    FROM public.comic_character_reference AS r
    WHERE r.user_id = source_message.sender_id
      AND r.conversation_id = source_message.conversation_id;

    IF pinned.user_id IS NULL THEN
        RAISE EXCEPTION 'character_reference_pin_failed'
            USING ERRCODE = '55000';
    END IF;

    RETURN pinned;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_pin_character_reference(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comic_pin_character_reference(UUID)
    TO service_role;
