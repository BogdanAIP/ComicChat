-- PR-37 — Compile an existing group conversation into a comic episode.
-- Closed groups: story can only be read by current group members.
-- Ordinary public groups: members accepted story-reuse terms before speaking,
-- so the author may publish with one action and no repeated permission request.
-- Reuse ComicPanel; do not enable adult-group publication or paid generation.

CREATE TABLE public.comic_group_episode (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.comic_group_profile(conversation_id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (CHAR_LENGTH(BTRIM(title)) BETWEEN 1 AND 100),
  message_ids UUID[] NOT NULL CHECK (CARDINALITY(message_ids) BETWEEN 1 AND 36),
  panels JSONB NOT NULL CHECK (
    JSONB_TYPEOF(panels)='array' AND JSONB_ARRAY_LENGTH(panels) BETWEEN 1 AND 36
  ),
  visibility TEXT NOT NULL DEFAULT 'group' CHECK (visibility IN ('group','public')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  CONSTRAINT comic_group_episode_published CHECK (
    (visibility='group' AND published_at IS NULL)
    OR (visibility='public' AND published_at IS NOT NULL)
  )
);

CREATE INDEX comic_group_episode_group_idx
  ON public.comic_group_episode(group_id,created_at DESC,id DESC);
CREATE INDEX comic_group_episode_public_idx
  ON public.comic_group_episode(published_at DESC,id DESC)
  WHERE visibility='public';

ALTER TABLE public.comic_group_episode ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comic_group_episode FROM PUBLIC,anon,authenticated;

-- A public story remains publishable only while its origin group is ordinary,
-- and every source panel's sender has a current membership plus a current
-- terms acceptance, acknowledged before their message was sent.
-- Fail closed if a member departs or later terms change. Published snapshots
-- never grant access to the source conversation or unseen private messages.
CREATE OR REPLACE FUNCTION public.comic_group_episode_public_eligible(p_episode_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comic_group_episode e
    JOIN public.comic_group_profile g ON g.conversation_id=e.group_id
    JOIN public.comic_membership creator
      ON creator.conversation_id=e.group_id AND creator.user_id=e.created_by
    WHERE e.id=p_episode_id
      AND g.visibility='public' AND NOT g.adult_theme
      AND NOT EXISTS (
        SELECT 1
        FROM UNNEST(e.message_ids) selected(id)
        LEFT JOIN public.comic_message m
          ON m.id=selected.id AND m.conversation_id=e.group_id
        WHERE m.id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.comic_membership member
          JOIN public.comic_group_terms_acceptance acceptance
            ON acceptance.conversation_id=member.conversation_id
           AND acceptance.user_id=member.user_id
          WHERE member.conversation_id=e.group_id
            AND member.user_id=m.sender_id
            AND acceptance.terms_version=g.terms_version
            AND acceptance.accepted_at <= m.created_at
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.comic_group_episode_public_eligible(UUID)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.comic_compile_group_episode(
  p_group_id UUID,
  p_message_ids UUID[],
  p_title TEXT DEFAULT 'Our group comic'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  me UUID := auth.uid();
  group_row public.comic_group_profile%ROWTYPE;
  source_count INTEGER;
  snapshot JSONB;
  episode_id UUID;
  clean_title TEXT := BTRIM(COALESCE(p_title,''));
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;
  IF NOT public.comic_account_interaction_allowed(me) THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE='42501';
  END IF;
  IF CHAR_LENGTH(clean_title) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_story_title' USING ERRCODE='22023';
  END IF;
  IF p_message_ids IS NULL OR CARDINALITY(p_message_ids) NOT BETWEEN 1 AND 36 THEN
    RAISE EXCEPTION 'invalid_story_selection' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM UNNEST(p_message_ids) selected(id)
    GROUP BY selected.id HAVING selected.id IS NULL OR COUNT(*)<>1
  ) THEN
    RAISE EXCEPTION 'invalid_story_selection' USING ERRCODE='22023';
  END IF;

  SELECT * INTO group_row FROM public.comic_group_profile
  WHERE conversation_id=p_group_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.comic_membership
    WHERE conversation_id=p_group_id AND user_id=me
  ) THEN
    RAISE EXCEPTION 'group_forbidden' USING ERRCODE='42501';
  END IF;

  -- No history from a foreign group or another conversation can be smuggled
  -- into an episode; a mismatch rejects the whole creation atomically.
  SELECT COUNT(*)::INTEGER INTO source_count
  FROM public.comic_message
  WHERE conversation_id=p_group_id AND id=ANY(p_message_ids);
  IF source_count<>CARDINALITY(p_message_ids) THEN
    RAISE EXCEPTION 'story_messages_forbidden' USING ERRCODE='42501';
  END IF;

  SELECT JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'id',m.id,'speaker',COALESCE(NULLIF(BTRIM(u.username),''),'Member'),
      'text',m.original_text,'created_at',m.created_at
    )
    ORDER BY m.created_at,m.id
  ) INTO snapshot
  FROM public.comic_message m
  LEFT JOIN public."user" u ON u.id=m.sender_id
  WHERE m.conversation_id=p_group_id AND m.id=ANY(p_message_ids);

  IF snapshot IS NULL OR JSONB_ARRAY_LENGTH(snapshot)<>source_count THEN
    RAISE EXCEPTION 'story_snapshot_invalid' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.comic_group_episode(
    group_id,created_by,title,message_ids,panels
  ) VALUES(p_group_id,me,clean_title,p_message_ids,snapshot)
  RETURNING id INTO episode_id;
  RETURN episode_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_publish_group_episode(p_episode_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  me UUID := auth.uid();
  episode public.comic_group_episode%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;
  IF NOT public.comic_account_interaction_allowed(me) THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE='42501';
  END IF;

  SELECT * INTO episode FROM public.comic_group_episode
  WHERE id=p_episode_id AND created_by=me
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'story_forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT public.comic_group_episode_public_eligible(p_episode_id) THEN
    RAISE EXCEPTION 'group_story_publication_forbidden' USING ERRCODE='42501';
  END IF;

  IF episode.visibility='group' THEN
    UPDATE public.comic_group_episode
    SET visibility='public',published_at=NOW() WHERE id=episode.id;
  END IF;
  RETURN TRUE;
END;
$$;

-- Group members may browse group-only episodes, including episodes compiled
-- by another member; ex-members lose access. No direct table read is granted.
CREATE OR REPLACE FUNCTION public.comic_list_group_episodes(
  p_group_id UUID,
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE(
  episode_id UUID,title TEXT,author_name TEXT,author_id UUID,panels JSONB,
  visibility TEXT,created_at TIMESTAMPTZ,published_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.comic_membership
    WHERE conversation_id=p_group_id AND user_id=auth.uid()
  ) THEN
    RAISE EXCEPTION 'group_forbidden' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT e.id,e.title,COALESCE(NULLIF(BTRIM(u.username),''),'Member'),
    e.created_by,e.panels,e.visibility,e.created_at,e.published_at
  FROM public.comic_group_episode e
  LEFT JOIN public."user" u ON u.id=e.created_by
  WHERE e.group_id=p_group_id
  ORDER BY e.created_at DESC,e.id DESC
  LIMIT GREATEST(1,LEAST(COALESCE(p_limit,30),50));
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_list_public_group_episodes(
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE(
  episode_id UUID,title TEXT,author_name TEXT,panels JSONB,
  published_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT e.id,e.title,COALESCE(NULLIF(BTRIM(u.username),''),'ComicChat creator'),
    e.panels,e.published_at
  FROM public.comic_group_episode e
  LEFT JOIN public."user" u ON u.id=e.created_by
  WHERE e.visibility='public'
    AND public.comic_group_episode_public_eligible(e.id)
  ORDER BY e.published_at DESC,e.id DESC
  LIMIT GREATEST(1,LEAST(COALESCE(p_limit,30),50));
END;
$$;

REVOKE ALL ON FUNCTION public.comic_compile_group_episode(UUID,UUID[],TEXT),
 public.comic_publish_group_episode(UUID),
 public.comic_list_group_episodes(UUID,INTEGER),
 public.comic_list_public_group_episodes(INTEGER)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.comic_compile_group_episode(UUID,UUID[],TEXT),
 public.comic_publish_group_episode(UUID),
 public.comic_list_group_episodes(UUID,INTEGER),
 public.comic_list_public_group_episodes(INTEGER)
 TO authenticated;


-- PR-36 correction: unqualified user_id in RETURNS TABLE was ambiguous
-- in the member authorization subquery. Keep this read guard reliable.
CREATE OR REPLACE FUNCTION public.comic_list_group_members(p_group_id UUID)
RETURNS TABLE(user_id UUID,username TEXT,member_role TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.comic_membership AS own
    WHERE own.conversation_id=p_group_id AND own.user_id=auth.uid()
  ) THEN
    RAISE EXCEPTION 'group_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT m.user_id,COALESCE(NULLIF(BTRIM(u.username),''),'Member'),m.role
  FROM public.comic_membership AS m
  LEFT JOIN public."user" AS u ON u.id=m.user_id
  WHERE m.conversation_id=p_group_id
  ORDER BY m.joined_at,m.user_id;
END;
$$;
