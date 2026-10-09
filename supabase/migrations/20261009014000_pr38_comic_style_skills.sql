-- PR-38: versioned art-direction Style Skills per conversation and immutable
-- per-message snapshots. Does not activate external/payed generation.
-- Adult/explicit styles are intentionally NOT available without age gating.

CREATE TABLE public.comic_conversation_style (
  conversation_id UUID PRIMARY KEY REFERENCES public.comic_conversation(id) ON DELETE CASCADE,
  primary_style_id TEXT NOT NULL DEFAULT 'anime',
  secondary_style_id TEXT,
  secondary_weight INTEGER NOT NULL DEFAULT 0,
  style_version INTEGER NOT NULL DEFAULT 1 CHECK (style_version=1),
  selected_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT comic_style_primary_allowed CHECK (
    primary_style_id IN ('anime','manga','superhero','cartoon','romance')
  ),
  CONSTRAINT comic_style_secondary_allowed CHECK (
    secondary_style_id IS NULL OR secondary_style_id IN ('anime','manga','superhero','cartoon','romance')
  ),
  CONSTRAINT comic_style_mix_valid CHECK (
    (secondary_style_id IS NULL AND secondary_weight=0)
    OR (secondary_style_id IS NOT NULL AND secondary_style_id<>primary_style_id
        AND secondary_weight BETWEEN 1 AND 90)
  )
);

CREATE TABLE public.comic_message_style (
  message_id UUID PRIMARY KEY REFERENCES public.comic_message(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.comic_conversation(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  primary_style_id TEXT NOT NULL CHECK (primary_style_id IN ('classic','anime','manga','superhero','cartoon','romance')),
  secondary_style_id TEXT CHECK (
    secondary_style_id IS NULL OR secondary_style_id IN ('anime','manga','superhero','cartoon','romance')
  ),
  secondary_weight INTEGER NOT NULL DEFAULT 0,
  style_version INTEGER NOT NULL DEFAULT 1 CHECK (style_version=1),
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT comic_message_mix_valid CHECK (
    (secondary_style_id IS NULL AND secondary_weight=0)
    OR (secondary_style_id IS NOT NULL AND secondary_style_id<>primary_style_id
        AND secondary_weight BETWEEN 1 AND 90)
  )
);
CREATE INDEX comic_message_style_conversation_idx
  ON public.comic_message_style(conversation_id,message_id);

ALTER TABLE public.comic_conversation_style ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_message_style ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comic_conversation_style,public.comic_message_style
  FROM PUBLIC,anon,authenticated;
-- The Edge provider is disabled by default. When deliberately activated,
-- this grant lets it read only frozen art-direction metadata.
GRANT SELECT ON public.comic_message_style TO service_role;

CREATE OR REPLACE FUNCTION public.comic_get_conversation_style(p_conversation_id UUID)
RETURNS TABLE(primary_style_id TEXT,secondary_style_id TEXT,
  secondary_weight INTEGER,style_version INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.comic_membership m
    WHERE m.conversation_id=p_conversation_id AND m.user_id=auth.uid()
  ) THEN
    RAISE EXCEPTION 'conversation_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT COALESCE(cs.primary_style_id,'anime'),
    cs.secondary_style_id,COALESCE(cs.secondary_weight,0),
    COALESCE(cs.style_version,1)
  FROM (SELECT 1 AS slot) singleton
  LEFT JOIN public.comic_conversation_style cs
    ON cs.conversation_id=p_conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_set_conversation_style(
  p_conversation_id UUID,
  p_primary_style_id TEXT,
  p_secondary_style_id TEXT DEFAULT NULL,
  p_secondary_weight INTEGER DEFAULT 0
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  me UUID := auth.uid();
  conversation_kind TEXT;
  my_role TEXT;
BEGIN
  IF me IS NULL OR NOT public.comic_account_interaction_allowed(me) THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE='42501';
  END IF;
  SELECT c.kind,m.role INTO conversation_kind,my_role
  FROM public.comic_conversation c
  JOIN public.comic_membership m ON m.conversation_id=c.id
  WHERE c.id=p_conversation_id AND m.user_id=me
  FOR SHARE OF c,m;
  IF NOT FOUND OR (conversation_kind='group' AND my_role<>'owner') THEN
    RAISE EXCEPTION 'style_change_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_primary_style_id IS NULL OR
     p_primary_style_id NOT IN ('anime','manga','superhero','cartoon','romance') OR
     (p_secondary_style_id IS NOT NULL AND
       p_secondary_style_id NOT IN ('anime','manga','superhero','cartoon','romance')) OR
     (p_secondary_style_id IS NULL AND p_secondary_weight IS DISTINCT FROM 0) OR
     (p_secondary_style_id IS NOT NULL AND
      (p_secondary_style_id=p_primary_style_id OR p_secondary_weight NOT BETWEEN 1 AND 90))
  THEN
    RAISE EXCEPTION 'invalid_style_configuration' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.comic_conversation_style(
    conversation_id,primary_style_id,secondary_style_id,secondary_weight,
    style_version,selected_by,updated_at
  ) VALUES (
    p_conversation_id,p_primary_style_id,p_secondary_style_id,
    p_secondary_weight,1,me,NOW()
  )
  ON CONFLICT(conversation_id) DO UPDATE SET
    primary_style_id=EXCLUDED.primary_style_id,
    secondary_style_id=EXCLUDED.secondary_style_id,
    secondary_weight=EXCLUDED.secondary_weight,
    style_version=EXCLUDED.style_version,
    selected_by=EXCLUDED.selected_by,
    updated_at=EXCLUDED.updated_at;
  RETURN TRUE;
END;
$$;

-- Message identity and its style are captured together at insertion, before
-- a later change to conversation style can affect historical illustrations.
CREATE OR REPLACE FUNCTION public.comic_snapshot_message_style()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO public.comic_message_style(
    message_id,conversation_id,sender_id,primary_style_id,
    secondary_style_id,secondary_weight,style_version
  )
  SELECT NEW.id,NEW.conversation_id,NEW.sender_id,
    COALESCE(cs.primary_style_id,'anime'),cs.secondary_style_id,
    COALESCE(cs.secondary_weight,0),COALESCE(cs.style_version,1)
  FROM (SELECT 1) singleton
  LEFT JOIN public.comic_conversation_style cs
    ON cs.conversation_id=NEW.conversation_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_snapshot_message_style() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER comic_message_style_snapshot_insert
  AFTER INSERT ON public.comic_message
  FOR EACH ROW EXECUTE FUNCTION public.comic_snapshot_message_style();

-- Existing pre-migration messages receive an immutable neutral metadata
-- snapshot without rewriting their message texts or generated art.
INSERT INTO public.comic_message_style(
  message_id,conversation_id,sender_id,primary_style_id,
  secondary_style_id,secondary_weight,style_version
)
SELECT m.id,m.conversation_id,m.sender_id,'classic',NULL,0,1
FROM public.comic_message m
ON CONFLICT (message_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.comic_list_message_styles(p_conversation_id UUID)
RETURNS TABLE(message_id UUID,primary_style_id TEXT,secondary_style_id TEXT,
  secondary_weight INTEGER,style_version INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.comic_membership m
    WHERE m.conversation_id=p_conversation_id AND m.user_id=auth.uid()
  ) THEN
    RAISE EXCEPTION 'conversation_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT ms.message_id,ms.primary_style_id,ms.secondary_style_id,
    ms.secondary_weight,ms.style_version
  FROM public.comic_message_style ms
  JOIN public.comic_message m ON m.id=ms.message_id
  WHERE ms.conversation_id=p_conversation_id
  ORDER BY m.created_at DESC,m.id DESC
  LIMIT 300;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_get_conversation_style(UUID),
  public.comic_set_conversation_style(UUID,TEXT,TEXT,INTEGER),
  public.comic_list_message_styles(UUID)
FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.comic_get_conversation_style(UUID),
  public.comic_set_conversation_style(UUID,TEXT,TEXT,INTEGER),
  public.comic_list_message_styles(UUID)
TO authenticated;

-- Preserve the render-time Skill selection when a conversation is compiled
-- into a story. The exact original words and author fields remain unchanged.
CREATE OR REPLACE FUNCTION public.comic_embed_story_panel_styles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  frozen_panels JSONB;
BEGIN
  SELECT JSONB_AGG(
    panel.value || JSONB_BUILD_OBJECT(
      'style',JSONB_BUILD_OBJECT(
        'primary_style_id',COALESCE(ms.primary_style_id,'classic'),
        'secondary_style_id',ms.secondary_style_id,
        'secondary_weight',COALESCE(ms.secondary_weight,0),
        'style_version',COALESCE(ms.style_version,1)
      )
    ) ORDER BY panel.ordinality
  )
  INTO frozen_panels
  FROM JSONB_ARRAY_ELEMENTS(NEW.panels) WITH ORDINALITY AS panel(value,ordinality)
  LEFT JOIN public.comic_message_style ms
    ON ms.message_id=(panel.value->>'id')::UUID;
  IF frozen_panels IS NOT NULL THEN NEW.panels=frozen_panels; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.comic_embed_story_panel_styles()
  FROM PUBLIC,anon,authenticated;

CREATE TRIGGER comic_group_episode_freeze_style
  BEFORE INSERT ON public.comic_group_episode
  FOR EACH ROW EXECUTE FUNCTION public.comic_embed_story_panel_styles();
CREATE TRIGGER comic_direct_episode_freeze_style
  BEFORE INSERT ON public.comic_story_episode
  FOR EACH ROW EXECUTE FUNCTION public.comic_embed_story_panel_styles();
