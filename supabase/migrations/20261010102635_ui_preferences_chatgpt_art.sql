-- UI preferences are self-only. ChatGPT assets reuse the private art bucket and
-- existing immutable asset IDs, queue and receipt/history contracts.
CREATE TABLE public.comic_ui_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru','en','ar')),
  theme TEXT NOT NULL DEFAULT 'classic' CHECK (theme IN ('classic','manga','anime','superhero','cartoon')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.comic_ui_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comic_ui_preferences FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.comic_get_my_preferences()
RETURNS TABLE(locale TEXT,theme TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT COALESCE(p.locale,'ru'),COALESCE(p.theme,'classic')
    FROM (SELECT 1) singleton LEFT JOIN public.comic_ui_preferences p ON p.user_id=auth.uid();
END;
$$;
CREATE FUNCTION public.comic_set_my_preferences(p_locale TEXT,p_theme TEXT)
RETURNS TABLE(locale TEXT,theme TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF p_locale IS NULL OR p_locale NOT IN ('ru','en','ar') OR p_theme IS NULL
    OR p_theme NOT IN ('classic','manga','anime','superhero','cartoon') THEN
    RAISE EXCEPTION 'invalid_preferences' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.comic_ui_preferences AS prefs(user_id,locale,theme)
  VALUES(auth.uid(),p_locale,p_theme) ON CONFLICT(user_id)
  DO UPDATE SET locale=EXCLUDED.locale,theme=EXCLUDED.theme,updated_at=NOW();
  RETURN QUERY SELECT p_locale,p_theme;
END;
$$;
REVOKE ALL ON FUNCTION public.comic_get_my_preferences(),public.comic_set_my_preferences(TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.comic_get_my_preferences(),public.comic_set_my_preferences(TEXT,TEXT) TO authenticated;

-- Only trusted attachment handlers can commit an already-uploaded asset.
-- Caller identity is verified with getUser by that handler, never taken from UI.
CREATE FUNCTION public.comic_commit_chatgpt_art(p_actor_id UUID,p_message_id UUID,p_asset_id UUID,p_mime_type TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  job public.comic_generation_job%ROWTYPE;
  msg public.comic_message%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_asset_id IS NULL OR p_mime_type IS NULL OR p_mime_type NOT IN ('image/webp','image/png','image/jpeg') OR NOT public.comic_account_interaction_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'message_unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO job FROM public.comic_generation_job WHERE message_id=p_message_id FOR UPDATE;
  SELECT * INTO msg FROM public.comic_message WHERE id=p_message_id AND sender_id=p_actor_id
    AND EXISTS(SELECT 1 FROM public.comic_membership m WHERE m.conversation_id=comic_message.conversation_id AND m.user_id=p_actor_id)
    AND EXISTS(SELECT 1 FROM public.comic_conversation c WHERE c.id=comic_message.conversation_id AND c.kind='direct')
    FOR UPDATE;
  IF msg.id IS NULL OR job.id IS NULL OR job.sender_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'message_unavailable' USING ERRCODE='42501';
  END IF;
  -- Lose any old render lease atomically, so an in-flight API worker cannot
  -- overwrite the explicitly attached ChatGPT illustration.
  UPDATE public.comic_generation_job SET provider='chatgpt-user-art',billing_source='chatgpt-user-provided',
    status='ready',media_asset_id=p_asset_id,attempt_asset_id=NULL,lease_token=NULL,lease_expires_at=NULL,
    error_code=NULL,error_detail=NULL,updated_at=NOW(),completed_at=NOW(),
    output_descriptor=JSONB_BUILD_OBJECT('illustration',JSONB_BUILD_OBJECT(
      'kind','private-comic-art','asset_id',p_asset_id,'mime_type',p_mime_type,'containsText',FALSE))
    WHERE id=job.id;
  UPDATE public.comic_message SET status='ready',updated_at=NOW() WHERE id=msg.id;
  RETURN p_asset_id;
END;
$$;
REVOKE ALL ON FUNCTION public.comic_commit_chatgpt_art(UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.comic_commit_chatgpt_art(UUID,UUID,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.comic_frozen_panel_metadata(p_message_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT JSONB_BUILD_OBJECT(
    'style',JSONB_BUILD_OBJECT('primary_style_id',COALESCE(ms.primary_style_id,'classic'),
      'secondary_style_id',ms.secondary_style_id,'secondary_weight',COALESCE(ms.secondary_weight,0),
      'style_version',COALESCE(ms.style_version,1)),
    'character',JSONB_BUILD_OBJECT('seed',public.comic_template_character_seed(
      m.id,m.sender_id,COALESCE(ms.primary_style_id,'classic')<>'classic')),
    'illustration',CASE WHEN j.status='ready' AND j.provider IN ('openai-image','chatgpt-user-art')
      AND j.media_asset_id IS NOT NULL AND j.output_descriptor->'illustration'->>'kind'='private-comic-art'
      THEN JSONB_BUILD_OBJECT('kind','private-comic-art','version',1,'asset_id',j.media_asset_id,
        'mime_type',COALESCE(j.output_descriptor->'illustration'->>'mime_type','image/webp'),'containsText',FALSE)
      ELSE NULL END)
  FROM public.comic_message m
  LEFT JOIN public.comic_message_style ms ON ms.message_id=m.id
  LEFT JOIN public.comic_generation_job j ON j.message_id=m.id
  WHERE m.id=p_message_id;
$$;
REVOKE ALL ON FUNCTION public.comic_frozen_panel_metadata(UUID) FROM PUBLIC,anon,authenticated;
