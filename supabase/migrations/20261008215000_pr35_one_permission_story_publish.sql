-- ComicChat PR-35: one permission grants creation + publication of one 1:1 story.
-- Reuses PR-20 snapshot consent: the initiator automatically consents when
-- requesting; the other participant gives ONE approval (or declines).
-- Does not enable publication of group conversations or private media files.
-- The episode is a bounded immutable snapshot of exact message text.

CREATE TABLE IF NOT EXISTS public.comic_story_episode (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE
    REFERENCES public.comic_publication_request(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL
    REFERENCES public.comic_conversation(id) ON DELETE CASCADE,
  author_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (
    CHAR_LENGTH(title) BETWEEN 1 AND 100
  ),
  panels JSONB NOT NULL CHECK (
    JSONB_TYPEOF(panels) = 'array'
    AND JSONB_ARRAY_LENGTH(panels) BETWEEN 1 AND 36
  ),
  published_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS comic_story_episode_feed_idx
  ON public.comic_story_episode (published_at DESC, id DESC);

ALTER TABLE public.comic_story_episode ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.comic_story_episode
  FROM PUBLIC, anon, authenticated;
-- Only explicit SECURITY DEFINER RPCs may read or write the snapshots.

CREATE OR REPLACE FUNCTION public.comic_release_approved_episode(
  p_request_id UUID,
  p_title TEXT DEFAULT 'Our comic story'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  me UUID := auth.uid();
  proposal public.comic_publication_request%ROWTYPE;
  cutoff_at TIMESTAMPTZ;
  snapshot JSONB;
  episode_id UUID;
  clean_title TEXT := BTRIM(COALESCE(p_title, ''));
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.comic_account_interaction_allowed(me) THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE = '42501';
  END IF;
  IF CHAR_LENGTH(clean_title) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_story_title' USING ERRCODE = '22023';
  END IF;

  SELECT r.* INTO proposal
  FROM public.comic_publication_request AS r
  WHERE r.id = p_request_id
    AND r.cancelled_at IS NULL
    AND r.requested_by = me
    AND EXISTS (
      SELECT 1 FROM public.comic_membership AS m
      WHERE m.conversation_id = r.conversation_id AND m.user_id = me
    )
    AND EXISTS (
      SELECT 1 FROM public.comic_conversation AS c
      WHERE c.id = r.conversation_id AND c.kind = 'direct'
    )
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'story_request_forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.comic_public_sharing_eligible(proposal.conversation_id)
     OR EXISTS (
       SELECT 1
       FROM public.comic_membership AS m
       WHERE m.conversation_id = proposal.conversation_id
         AND NOT EXISTS (
           SELECT 1 FROM public.comic_publication_consent AS consent
           WHERE consent.request_id = proposal.id
             AND consent.user_id = m.user_id
         )
     ) THEN
    RAISE EXCEPTION 'story_permission_required' USING ERRCODE = '42501';
  END IF;

  -- One grant also covers making the story; no second approval.
  -- Publishing after revocation is forbidden; an already published story is
  -- hidden immediately by the feed's live consent checks.
  SELECT e.id INTO episode_id
  FROM public.comic_story_episode AS e
  WHERE e.request_id = proposal.id;

  IF episode_id IS NOT NULL THEN
    RETURN episode_id;
  END IF;

  SELECT m.created_at INTO cutoff_at
  FROM public.comic_message AS m
  WHERE m.id = proposal.through_message_id
    AND m.conversation_id = proposal.conversation_id;

  IF cutoff_at IS NULL THEN
    RAISE EXCEPTION 'snapshot_message_forbidden' USING ERRCODE = '42501';
  END IF;

  -- A fixed maximum prevents turning a consent for a small scene into a
  -- giant history export; messages after the cutoff are never included.
  WITH authorized_messages AS (
    SELECT m.id, m.sender_id, m.original_text, m.created_at
    FROM public.comic_message AS m
    WHERE m.conversation_id = proposal.conversation_id
      AND (m.created_at, m.id) <= (cutoff_at, proposal.through_message_id)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 36
  ), ordered_messages AS (
    SELECT *
    FROM authorized_messages
    ORDER BY created_at ASC, id ASC
  )
  SELECT JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'id', m.id,
      'speaker', COALESCE(
        NULLIF(BTRIM(u.username), ''), 'Participant'
      ),
      'text', m.original_text,
      'created_at', m.created_at
    ) ORDER BY m.created_at, m.id
  ) INTO snapshot
  FROM ordered_messages AS m
  LEFT JOIN public."user" AS u ON u.id = m.sender_id;

  IF snapshot IS NULL OR JSONB_ARRAY_LENGTH(snapshot) = 0 THEN
    RAISE EXCEPTION 'story_snapshot_empty' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.comic_story_episode (
    request_id, conversation_id, author_id, title, panels
  ) VALUES (
    proposal.id, proposal.conversation_id, me, clean_title, snapshot
  )
  ON CONFLICT (request_id) DO NOTHING
  RETURNING id INTO episode_id;

  IF episode_id IS NULL THEN
    SELECT e.id INTO episode_id
    FROM public.comic_story_episode AS e
    WHERE e.request_id = proposal.id;
  END IF;
  RETURN episode_id;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_release_approved_episode(UUID,TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_release_approved_episode(UUID,TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_list_released_episodes(
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE (
  episode_id UUID,
  title TEXT,
  author_name TEXT,
  panels JSONB,
  published_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id, e.title,
    COALESCE(NULLIF(BTRIM(u.username), ''), 'ComicChat creator'),
    e.panels, e.published_at
  FROM public.comic_story_episode AS e
  JOIN public.comic_publication_request AS r
    ON r.id = e.request_id
  LEFT JOIN public."user" AS u ON u.id = e.author_id
  WHERE r.cancelled_at IS NULL
    AND public.comic_public_sharing_eligible(r.conversation_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.comic_membership AS m
      WHERE m.conversation_id = r.conversation_id
        AND NOT EXISTS (
          SELECT 1 FROM public.comic_publication_consent AS consent
          WHERE consent.request_id = r.id
            AND consent.user_id = m.user_id
        )
    )
  ORDER BY e.published_at DESC, e.id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 50));
END;
$$;

REVOKE ALL ON FUNCTION public.comic_list_released_episodes(INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_list_released_episodes(INTEGER)
  TO authenticated;
