-- ComicChat audit fixes: reuse the existing consent, episode and job domains.
-- External generation remains OFF; no public Storage access or new queue.

-- NOW() is already an absolute timestamptz. Converting it to a naive UTC
-- timestamp and back shifts message times on non-UTC hosts and bypasses the
-- CURRENT_TIMESTAMP-based send quota. Historical rows are never rewritten.
ALTER TABLE public.comic_message
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE public.comic_generation_job
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN attempt_asset_id UUID,
  ADD COLUMN media_asset_id UUID;
CREATE INDEX comic_generation_job_due_idx
  ON public.comic_generation_job(provider,next_attempt_at,created_at,id)
  WHERE status='queued';

-- Existing completed assets used the message ID as their immutable locator.
-- New attempts use a fresh opaque ID and never overwrite another attempt.
UPDATE public.comic_generation_job
SET media_asset_id=(output_descriptor->'illustration'->>'asset_id')::UUID
WHERE status='ready' AND provider='openai-image'
  AND output_descriptor->'illustration'->>'kind'='private-comic-art'
  AND output_descriptor->'illustration'->>'asset_id'
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- Match TemplateRenderer's FNV-1a seed for ASCII UUIDs. No name-based identity.
CREATE FUNCTION public.comic_template_character_seed(
  p_message_id UUID,p_sender_id UUID,p_styled BOOLEAN
)
RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE
  seed BIGINT := 2166136261;
  identity TEXT := CASE WHEN p_styled THEN p_sender_id::TEXT ELSE p_message_id::TEXT END;
  i INTEGER;
BEGIN
  FOR i IN 1..CHAR_LENGTH(identity) LOOP
    seed=((seed # ASCII(SUBSTR(identity,i,1))) * 16777619) & 4294967295;
  END LOOP;
  RETURN seed;
END;
$$;
REVOKE ALL ON FUNCTION public.comic_template_character_seed(UUID,UUID,BOOLEAN)
  FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.comic_frozen_panel_metadata(p_message_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT JSONB_BUILD_OBJECT(
    'style',JSONB_BUILD_OBJECT(
      'primary_style_id',COALESCE(ms.primary_style_id,'classic'),
      'secondary_style_id',ms.secondary_style_id,
      'secondary_weight',COALESCE(ms.secondary_weight,0),
      'style_version',COALESCE(ms.style_version,1)
    ),
    'character',JSONB_BUILD_OBJECT('seed',public.comic_template_character_seed(
      m.id,m.sender_id,COALESCE(ms.primary_style_id,'classic')<>'classic'
    )),
    'illustration',CASE WHEN j.status='ready' AND j.provider='openai-image'
      AND j.media_asset_id IS NOT NULL
      AND j.output_descriptor->'illustration'->>'kind'='private-comic-art'
      THEN JSONB_BUILD_OBJECT('kind','private-comic-art','version',1,
        'asset_id',j.media_asset_id,'mime_type','image/webp','containsText',FALSE)
      ELSE NULL END
  )
  FROM public.comic_message m
  LEFT JOIN public.comic_message_style ms ON ms.message_id=m.id
  LEFT JOIN public.comic_generation_job j ON j.message_id=m.id
  WHERE m.id=p_message_id;
$$;
REVOKE ALL ON FUNCTION public.comic_frozen_panel_metadata(UUID)
  FROM PUBLIC,anon,authenticated;

-- A consent preview and its published episode must use the SAME saved payload,
-- even after a user renames a profile or a previously queued artwork finishes.
CREATE FUNCTION public.comic_direct_snapshot_panels(
  p_conversation_id UUID,p_through_message_id UUID
)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  WITH cutoff AS (
    SELECT created_at,id FROM public.comic_message
    WHERE id=p_through_message_id AND conversation_id=p_conversation_id
  ), recent AS (
    SELECT m.* FROM public.comic_message m CROSS JOIN cutoff
    WHERE m.conversation_id=p_conversation_id
      AND (m.created_at,m.id)<=(cutoff.created_at,cutoff.id)
    ORDER BY m.created_at DESC,m.id DESC LIMIT 36
  )
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'id',m.id,'speaker',COALESCE(NULLIF(BTRIM(u.username),''),'Participant'),
    'text',m.original_text,'created_at',m.created_at
  ) || public.comic_frozen_panel_metadata(m.id) ORDER BY m.created_at,m.id)
  FROM recent m LEFT JOIN public."user" u ON u.id=m.sender_id;
$$;
REVOKE ALL ON FUNCTION public.comic_direct_snapshot_panels(UUID,UUID)
  FROM PUBLIC,anon,authenticated;

-- Repair character identity of legacy episodes without changing their words,
-- saved styles or template artwork. Missing old art stays a frozen template.
UPDATE public.comic_story_episode e SET panels=(
  SELECT JSONB_AGG(COALESCE(public.comic_frozen_panel_metadata((panel.value->>'id')::UUID),'{}'::JSONB)
    || panel.value || JSONB_BUILD_OBJECT('illustration',COALESCE(panel.value->'illustration','null'::JSONB))
    ORDER BY panel.ordinality)
  FROM JSONB_ARRAY_ELEMENTS(e.panels) WITH ORDINALITY panel(value,ordinality));
UPDATE public.comic_group_episode e SET panels=(
  SELECT JSONB_AGG(COALESCE(public.comic_frozen_panel_metadata((panel.value->>'id')::UUID),'{}'::JSONB)
    || panel.value || JSONB_BUILD_OBJECT('illustration',COALESCE(panel.value->'illustration','null'::JSONB))
    ORDER BY panel.ordinality)
  FROM JSONB_ARRAY_ELEMENTS(e.panels) WITH ORDINALITY panel(value,ordinality));

ALTER TABLE public.comic_publication_request ADD COLUMN panels JSONB;
ALTER TABLE public.comic_publication_request ADD CONSTRAINT comic_request_panels_bounded
  CHECK(panels IS NULL OR (JSONB_TYPEOF(panels)='array'
    AND JSONB_ARRAY_LENGTH(panels) BETWEEN 1 AND 36));

-- Published requests inherit their already frozen episode, never a new history.
UPDATE public.comic_publication_request r SET panels=e.panels
FROM public.comic_story_episode e WHERE e.request_id=r.id AND r.panels IS NULL;
UPDATE public.comic_publication_request r
SET panels=public.comic_direct_snapshot_panels(r.conversation_id,r.through_message_id)
WHERE r.panels IS NULL AND r.cancelled_at IS NULL
  AND public.comic_public_sharing_eligible(r.conversation_id)
  AND EXISTS(SELECT 1 FROM public.comic_conversation c
    WHERE c.id=r.conversation_id AND c.kind='direct');

CREATE OR REPLACE FUNCTION public.comic_propose_public_snapshot(
  p_conversation_id UUID,p_through_message_id UUID
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  me UUID := auth.uid();
  v_request_id UUID;
  frozen JSONB;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comic_membership m
    WHERE m.conversation_id=p_conversation_id AND m.user_id=me) THEN
    RAISE EXCEPTION 'conversation_forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT public.comic_account_interaction_allowed(me) THEN
    RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comic_conversation c
    WHERE c.id=p_conversation_id AND c.kind='direct') THEN
    RAISE EXCEPTION 'sharing_not_supported' USING ERRCODE='22023';
  END IF;
  IF NOT public.comic_public_sharing_eligible(p_conversation_id) THEN
    RAISE EXCEPTION 'public_sharing_ineligible' USING ERRCODE='42501';
  END IF;
  frozen=public.comic_direct_snapshot_panels(p_conversation_id,p_through_message_id);
  IF frozen IS NULL THEN
    RAISE EXCEPTION 'snapshot_message_forbidden' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.comic_publication_request(
    conversation_id,through_message_id,requested_by,panels
  ) VALUES(p_conversation_id,p_through_message_id,me,frozen)
  ON CONFLICT(conversation_id,through_message_id) WHERE cancelled_at IS NULL
  DO UPDATE SET panels=COALESCE(public.comic_publication_request.panels,EXCLUDED.panels)
  RETURNING id INTO v_request_id;
  INSERT INTO public.comic_publication_consent(request_id,user_id)
  VALUES(v_request_id,me)
  ON CONFLICT(request_id,user_id) DO UPDATE SET consented_at=EXCLUDED.consented_at;
  RETURN v_request_id;
END;
$$;

CREATE FUNCTION public.comic_read_publication_preview(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  me UUID := auth.uid();
  proposal public.comic_publication_request%ROWTYPE;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT r.* INTO proposal FROM public.comic_publication_request r
  WHERE r.id=p_request_id AND r.cancelled_at IS NULL
    AND EXISTS(SELECT 1 FROM public.comic_membership m
      WHERE m.conversation_id=r.conversation_id AND m.user_id=me);
  IF NOT FOUND OR NOT public.comic_account_interaction_allowed(me)
    OR NOT public.comic_public_sharing_eligible(proposal.conversation_id)
    OR proposal.panels IS NULL THEN
    RAISE EXCEPTION 'publication_request_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN proposal.panels;
END;
$$;
REVOKE ALL ON FUNCTION public.comic_read_publication_preview(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.comic_read_publication_preview(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.comic_release_approved_episode(
  p_request_id UUID,p_title TEXT DEFAULT 'Our comic story'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  me UUID := auth.uid();
  proposal public.comic_publication_request%ROWTYPE;
  episode_id UUID;
  clean_title TEXT := BTRIM(COALESCE(p_title,''));
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.comic_account_interaction_allowed(me) THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE='42501';
  END IF;
  IF CHAR_LENGTH(clean_title) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_story_title' USING ERRCODE='22023';
  END IF;
  SELECT r.* INTO proposal FROM public.comic_publication_request r
  WHERE r.id=p_request_id AND r.cancelled_at IS NULL AND r.requested_by=me
    AND EXISTS(SELECT 1 FROM public.comic_membership m
      WHERE m.conversation_id=r.conversation_id AND m.user_id=me)
    AND EXISTS(SELECT 1 FROM public.comic_conversation c
      WHERE c.id=r.conversation_id AND c.kind='direct')
  FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'story_request_forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT public.comic_public_sharing_eligible(proposal.conversation_id)
    OR EXISTS(SELECT 1 FROM public.comic_membership m
      WHERE m.conversation_id=proposal.conversation_id
        AND NOT EXISTS(SELECT 1 FROM public.comic_publication_consent consent
          WHERE consent.request_id=proposal.id AND consent.user_id=m.user_id)) THEN
    RAISE EXCEPTION 'story_permission_required' USING ERRCODE='42501';
  END IF;
  IF proposal.panels IS NULL OR JSONB_ARRAY_LENGTH(proposal.panels) NOT BETWEEN 1 AND 36 THEN
    RAISE EXCEPTION 'story_snapshot_empty' USING ERRCODE='22023';
  END IF;
  SELECT e.id INTO episode_id FROM public.comic_story_episode e WHERE e.request_id=proposal.id;
  IF episode_id IS NOT NULL THEN RETURN episode_id; END IF;
  INSERT INTO public.comic_story_episode(request_id,conversation_id,author_id,title,panels)
  VALUES(proposal.id,proposal.conversation_id,me,clean_title,proposal.panels)
  RETURNING id INTO episode_id;
  RETURN episode_id;
END;
$$;

-- One freezer for direct + group episodes. Already-frozen preview values win;
-- newly compiled group panels receive the same safe metadata.
CREATE OR REPLACE FUNCTION public.comic_embed_story_panel_styles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  SELECT JSONB_AGG(COALESCE(public.comic_frozen_panel_metadata((panel.value->>'id')::UUID),'{}'::JSONB)
    || panel.value ORDER BY panel.ordinality)
  INTO NEW.panels
  FROM JSONB_ARRAY_ELEMENTS(NEW.panels) WITH ORDINALITY panel(value,ordinality);
  RETURN NEW;
END;
$$;

-- Historical reads remain available after block/deletion-request, as in PR17.
-- Neither reader admits former group members or foreign/unknown IDs.
CREATE FUNCTION public.comic_read_message(p_message_id UUID)
RETURNS TABLE(id UUID,conversation_id UUID,sender_id UUID,client_nonce UUID,
  original_text TEXT,status TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,
  style JSONB,"character" JSONB,illustration JSONB,media_asset_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comic_message m
    JOIN public.comic_membership member ON member.conversation_id=m.conversation_id
    WHERE m.id=p_message_id AND member.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'message_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT m.id,m.conversation_id,m.sender_id,m.client_nonce,
    m.original_text,m.status,m.created_at,m.updated_at,
    CASE WHEN meta.value->'style'->>'primary_style_id'='classic' THEN NULL ELSE meta.value->'style' END,
    meta.value->'character',meta.value->'illustration',
    (meta.value->'illustration'->>'asset_id')::UUID
  FROM public.comic_message m
  CROSS JOIN LATERAL(SELECT public.comic_frozen_panel_metadata(m.id) AS value) meta
  WHERE m.id=p_message_id;
END;
$$;

CREATE FUNCTION public.comic_read_message_page(
  p_conversation_id UUID,p_limit INTEGER DEFAULT 50,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,p_before_id UUID DEFAULT NULL
)
RETURNS TABLE(id UUID,conversation_id UUID,sender_id UUID,client_nonce UUID,
  original_text TEXT,status TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,
  style JSONB,"character" JSONB,illustration JSONB,media_asset_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.comic_membership m
    WHERE m.conversation_id=p_conversation_id AND m.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'conversation_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_message_limit' USING ERRCODE='22023';
  END IF;
  IF (p_before_created_at IS NULL)<>(p_before_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_message_cursor' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT recent.id,recent.conversation_id,recent.sender_id,recent.client_nonce,
    recent.original_text,recent.status,recent.created_at,recent.updated_at,
    CASE WHEN meta.value->'style'->>'primary_style_id'='classic' THEN NULL ELSE meta.value->'style' END,
    meta.value->'character',meta.value->'illustration',
    (meta.value->'illustration'->>'asset_id')::UUID
  FROM(SELECT m.* FROM public.comic_message m
    WHERE m.conversation_id=p_conversation_id
      AND(p_before_created_at IS NULL OR(m.created_at,m.id)<(p_before_created_at,p_before_id))
    ORDER BY m.created_at DESC,m.id DESC LIMIT p_limit) recent
  CROSS JOIN LATERAL(SELECT public.comic_frozen_panel_metadata(recent.id) AS value) meta
  ORDER BY recent.created_at,recent.id;
END;
$$;
REVOKE ALL ON FUNCTION public.comic_read_message(UUID),
  public.comic_read_message_page(UUID,INTEGER,TIMESTAMPTZ,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.comic_read_message(UUID),
  public.comic_read_message_page(UUID,INTEGER,TIMESTAMPTZ,UUID) TO authenticated;

CREATE FUNCTION public.comic_broadcast_style_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM realtime.send(JSONB_BUILD_OBJECT('operation','STYLE_UPDATE',
    'conversation_id',NEW.conversation_id),'STYLE_UPDATE',
    'conversation:' || NEW.conversation_id::TEXT,TRUE);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.comic_broadcast_style_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER comic_conversation_style_broadcast
AFTER INSERT OR UPDATE ON public.comic_conversation_style
FOR EACH ROW EXECUTE FUNCTION public.comic_broadcast_style_change();

-- This predicate is shared by the public feed and the private asset resolver.
CREATE FUNCTION public.comic_direct_episode_public_eligible(p_episode_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.comic_story_episode e
    JOIN public.comic_publication_request r ON r.id=e.request_id
    WHERE e.id=p_episode_id AND r.cancelled_at IS NULL
      AND public.comic_public_sharing_eligible(r.conversation_id)
      AND NOT EXISTS(SELECT 1 FROM public.comic_membership m
        WHERE m.conversation_id=r.conversation_id AND NOT EXISTS(
          SELECT 1 FROM public.comic_publication_consent consent
          WHERE consent.request_id=r.id AND consent.user_id=m.user_id)));
$$;
REVOKE ALL ON FUNCTION public.comic_direct_episode_public_eligible(UUID)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.comic_list_released_episodes(p_limit INTEGER DEFAULT 30)
RETURNS TABLE(episode_id UUID,title TEXT,author_name TEXT,panels JSONB,published_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT e.id,e.title,
    COALESCE(NULLIF(BTRIM(u.username),''),'ComicChat creator'),e.panels,e.published_at
  FROM public.comic_story_episode e LEFT JOIN public."user" u ON u.id=e.author_id
  WHERE public.comic_direct_episode_public_eligible(e.id)
  ORDER BY e.published_at DESC,e.id DESC
  LIMIT GREATEST(1,LEAST(COALESCE(p_limit,30),50));
END;
$$;

-- Trusted proxy only: viewer ID MUST come from validated auth.getUser(), not
-- request input. No locator is returned through a user-facing RPC or feed.
CREATE FUNCTION public.comic_resolve_episode_asset(
  p_episode_kind TEXT,p_episode_id UUID,p_panel_index INTEGER,p_viewer_id UUID
)
RETURNS TABLE(asset_id UUID,conversation_id UUID,message_id UUID,mime_type TEXT,object_path TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  panel JSONB;
  source_conversation UUID;
  source_message UUID;
  asset UUID;
BEGIN
  IF p_viewer_id IS NULL OR p_panel_index IS NULL OR p_panel_index NOT BETWEEN 0 AND 35
    OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_viewer_id) THEN
    RAISE EXCEPTION 'episode_asset_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_episode_kind='direct' THEN
    SELECT e.panels->p_panel_index,e.conversation_id INTO panel,source_conversation
    FROM public.comic_story_episode e
    WHERE e.id=p_episode_id AND public.comic_direct_episode_public_eligible(e.id);
  ELSIF p_episode_kind='group' THEN
    SELECT e.panels->p_panel_index,e.group_id INTO panel,source_conversation
    FROM public.comic_group_episode e
    WHERE e.id=p_episode_id AND(
      (e.visibility='public' AND public.comic_group_episode_public_eligible(e.id))
      OR EXISTS(SELECT 1 FROM public.comic_membership m
        WHERE m.conversation_id=e.group_id AND m.user_id=p_viewer_id));
  END IF;
  IF panel IS NULL OR panel->'illustration'->>'kind' IS DISTINCT FROM 'private-comic-art'
    OR panel->'illustration'->>'asset_id' IS NULL THEN
    RAISE EXCEPTION 'episode_asset_forbidden' USING ERRCODE='42501';
  END IF;
  source_message=(panel->>'id')::UUID;
  asset=(panel->'illustration'->>'asset_id')::UUID;
  RETURN QUERY SELECT asset,source_conversation,source_message,'image/webp'::TEXT,
    source_conversation::TEXT || '/' || source_message::TEXT ||
      CASE WHEN asset=source_message THEN '.webp' ELSE '/' || asset::TEXT || '.webp' END;
END;
$$;
REVOKE ALL ON FUNCTION public.comic_resolve_episode_asset(TEXT,UUID,INTEGER,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.comic_resolve_episode_asset(TEXT,UUID,INTEGER,UUID) TO service_role;

-- Reuse one lease state machine for both bounded server drain and sender kick.
-- Retry timers are persisted, so closing a browser cannot reset backoff.
CREATE FUNCTION public.comic_generation_retry_delay(p_attempt INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT LEAST(300,5 * (1 << LEAST(GREATEST(COALESCE(p_attempt,1)-1,0),6)));
$$;
REVOKE ALL ON FUNCTION public.comic_generation_retry_delay(INTEGER)
  FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.comic_generation_provider_enabled(p_provider TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT p_provider='mock' OR(p_provider='openai-image' AND EXISTS(
    SELECT 1 FROM public.comic_generation_config c
    WHERE c.singleton_id=1 AND c.external_generation_enabled AND c.provider=p_provider));
$$;
REVOKE ALL ON FUNCTION public.comic_generation_provider_enabled(TEXT)
  FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.comic_record_generation_event(
  p_job public.comic_generation_job,p_event TEXT,p_metadata JSONB,
  p_units BIGINT DEFAULT 0,p_cost BIGINT DEFAULT 0
)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  INSERT INTO public.comic_usage_ledger(job_id,message_id,sender_id,provider,
    billing_source,attempt_no,event_type,billable_units,cost_microunits,metadata)
  VALUES((p_job).id,(p_job).message_id,(p_job).sender_id,(p_job).provider,(p_job).billing_source,
    (p_job).attempt_count,p_event,p_units,p_cost,p_metadata)
  ON CONFLICT(job_id,attempt_no,event_type) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.comic_record_generation_event(
  public.comic_generation_job,TEXT,JSONB,BIGINT,BIGINT)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.comic_claim_generation_job_for_message(
  p_message_id UUID,p_provider TEXT,p_lease_seconds INTEGER DEFAULT 180
)
RETURNS SETOF public.comic_generation_job
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  now_utc TIMESTAMPTZ := NOW();
  candidate public.comic_generation_job%ROWTYPE;
  claimed public.comic_generation_job%ROWTYPE;
  delay_seconds INTEGER;
BEGIN
  IF NOT COALESCE(public.comic_generation_provider_enabled(p_provider),FALSE) THEN
    RAISE EXCEPTION 'provider_not_enabled' USING ERRCODE='22023';
  END IF;
  SELECT j.* INTO candidate FROM public.comic_generation_job j
  WHERE j.message_id=p_message_id AND j.provider=p_provider FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'generation_job_not_found' USING ERRCODE='22023'; END IF;
  IF candidate.status IN('ready','failed') THEN RETURN; END IF;
  IF candidate.status='rendering' AND candidate.lease_expires_at>now_utc THEN RETURN; END IF;
  IF candidate.status='queued' AND candidate.next_attempt_at>now_utc THEN RETURN; END IF;

  IF candidate.status='rendering' THEN
    PERFORM public.comic_record_generation_event(candidate,'failed',JSONB_BUILD_OBJECT(
      'code','lease_expired','retryable',candidate.attempt_count<candidate.max_attempts));
    IF candidate.attempt_count<candidate.max_attempts THEN
      delay_seconds=public.comic_generation_retry_delay(candidate.attempt_count);
      PERFORM public.comic_record_generation_event(candidate,'retry_scheduled',
        JSONB_BUILD_OBJECT('reason','lease_expired','delay_seconds',delay_seconds));
      UPDATE public.comic_generation_job SET status='queued',lease_token=NULL,
        lease_expires_at=NULL,attempt_asset_id=NULL,media_asset_id=NULL,
        next_attempt_at=now_utc+pg_catalog.make_interval(secs=>delay_seconds),
        output_descriptor=NULL,error_code='lease_expired',error_detail=NULL,
        updated_at=now_utc,completed_at=NULL WHERE id=candidate.id;
      UPDATE public.comic_message SET status='queued',updated_at=now_utc
      WHERE id=candidate.message_id;
      RETURN;
    END IF;
  END IF;
  IF candidate.attempt_count>=candidate.max_attempts THEN
    UPDATE public.comic_generation_job SET status='failed',lease_token=NULL,
      lease_expires_at=NULL,attempt_asset_id=NULL,media_asset_id=NULL,
      output_descriptor=NULL,error_code='attempts_exhausted',error_detail=NULL,
      updated_at=now_utc,completed_at=now_utc WHERE id=candidate.id;
    UPDATE public.comic_message SET status='failed',updated_at=now_utc WHERE id=candidate.message_id;
    RETURN;
  END IF;
  UPDATE public.comic_generation_job SET status='rendering',
    attempt_count=candidate.attempt_count+1,lease_token=gen_random_uuid(),
    lease_expires_at=now_utc+pg_catalog.make_interval(secs=>LEAST(
      GREATEST(COALESCE(p_lease_seconds,180),5),900)),
    attempt_asset_id=gen_random_uuid(),media_asset_id=NULL,
    output_descriptor=NULL,error_code=NULL,error_detail=NULL,
    updated_at=now_utc,completed_at=NULL
  WHERE id=candidate.id RETURNING * INTO claimed;
  UPDATE public.comic_message SET status='rendering',updated_at=now_utc WHERE id=claimed.message_id;
  PERFORM public.comic_record_generation_event(claimed,'started',
    JSONB_BUILD_OBJECT('lease_expires_at',claimed.lease_expires_at));
  RETURN NEXT claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_claim_generation_job(
  p_provider TEXT DEFAULT 'mock',p_lease_seconds INTEGER DEFAULT 60
)
RETURNS SETOF public.comic_generation_job
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  candidate public.comic_generation_job%ROWTYPE;
  claimed public.comic_generation_job%ROWTYPE;
  examined INTEGER;
BEGIN
  IF NOT COALESCE(public.comic_generation_provider_enabled(p_provider),FALSE) THEN
    RAISE EXCEPTION 'provider_not_enabled' USING ERRCODE='22023';
  END IF;
  -- Sweep expired/exhausted jobs with the SAME transition used by exact claim.
  -- This bounded loop keeps a terminal backlog from holding one call forever.
  FOR examined IN 1..100
  LOOP
    SELECT j.* INTO candidate FROM public.comic_generation_job j
    WHERE j.provider=p_provider AND(
      (j.status='queued' AND j.next_attempt_at<=NOW())
      OR(j.status='rendering' AND j.lease_expires_at<=NOW()))
    ORDER BY j.created_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT j.* INTO claimed FROM public.comic_claim_generation_job_for_message(
      candidate.message_id,p_provider,p_lease_seconds) j;
    IF claimed.id IS NOT NULL THEN RETURN NEXT claimed; RETURN; END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_complete_generation_job(
  p_job_id UUID,p_lease_token UUID,p_output_descriptor JSONB,
  p_billable_units BIGINT DEFAULT 0,p_cost_microunits BIGINT DEFAULT 0
)
RETURNS public.comic_generation_job
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  now_utc TIMESTAMPTZ := NOW();
  current_job public.comic_generation_job%ROWTYPE;
  completed public.comic_generation_job%ROWTYPE;
  asset UUID;
BEGIN
  IF p_output_descriptor IS NULL OR JSONB_TYPEOF(p_output_descriptor)<>'object' THEN
    RAISE EXCEPTION 'invalid_output_descriptor' USING ERRCODE='22023';
  END IF;
  IF COALESCE(p_billable_units,-1)<0 OR COALESCE(p_cost_microunits,-1)<0 THEN
    RAISE EXCEPTION 'invalid_usage_amount' USING ERRCODE='22023';
  END IF;
  SELECT j.* INTO current_job FROM public.comic_generation_job j WHERE j.id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'generation_job_not_found' USING ERRCODE='22023'; END IF;
  IF current_job.status<>'rendering' OR current_job.lease_token IS DISTINCT FROM p_lease_token
    OR current_job.lease_expires_at<=now_utc THEN
    RAISE EXCEPTION 'stale_generation_lease' USING ERRCODE='40001';
  END IF;
  IF current_job.provider='openai-image'
    OR p_output_descriptor->'illustration'->>'kind'='private-comic-art' THEN
    IF current_job.provider<>'openai-image'
      OR p_output_descriptor->'illustration'->>'kind' IS DISTINCT FROM 'private-comic-art'
      OR p_output_descriptor->'illustration'->>'asset_id' IS DISTINCT FROM current_job.attempt_asset_id::TEXT
      OR p_output_descriptor->'illustration'->>'containsText' IS DISTINCT FROM 'false'
      OR p_output_descriptor->'illustration'->>'mime_type' IS DISTINCT FROM 'image/webp' THEN
      RAISE EXCEPTION 'invalid_art_descriptor' USING ERRCODE='22023';
    END IF;
    asset=current_job.attempt_asset_id;
  END IF;
  UPDATE public.comic_generation_job SET status='ready',lease_token=NULL,
    lease_expires_at=NULL,attempt_asset_id=NULL,media_asset_id=asset,
    output_descriptor=p_output_descriptor,error_code=NULL,error_detail=NULL,
    updated_at=now_utc,completed_at=now_utc WHERE id=current_job.id RETURNING * INTO completed;
  UPDATE public.comic_message SET status='ready',updated_at=now_utc WHERE id=completed.message_id;
  PERFORM public.comic_record_generation_event(completed,'succeeded',
    '{"result":"ready"}'::JSONB,p_billable_units,p_cost_microunits);
  RETURN completed;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_fail_generation_job(
  p_job_id UUID,p_lease_token UUID,p_error_code TEXT,p_error_detail TEXT DEFAULT NULL,
  p_retryable BOOLEAN DEFAULT TRUE
)
RETURNS public.comic_generation_job
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  now_utc TIMESTAMPTZ := NOW();
  current_job public.comic_generation_job%ROWTYPE;
  failed public.comic_generation_job%ROWTYPE;
  next_status TEXT;
  delay_seconds INTEGER;
BEGIN
  SELECT j.* INTO current_job FROM public.comic_generation_job j WHERE j.id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'generation_job_not_found' USING ERRCODE='22023'; END IF;
  IF current_job.status<>'rendering' OR current_job.lease_token IS DISTINCT FROM p_lease_token
    OR current_job.lease_expires_at<=now_utc THEN
    RAISE EXCEPTION 'stale_generation_lease' USING ERRCODE='40001';
  END IF;
  next_status=CASE WHEN COALESCE(p_retryable,FALSE)
    AND current_job.attempt_count<current_job.max_attempts THEN 'queued' ELSE 'failed' END;
  delay_seconds=public.comic_generation_retry_delay(current_job.attempt_count);
  PERFORM public.comic_record_generation_event(current_job,'failed',JSONB_BUILD_OBJECT(
    'code',COALESCE(NULLIF(p_error_code,''),'generation_failed'),'retryable',next_status='queued'));
  IF next_status='queued' THEN
    PERFORM public.comic_record_generation_event(current_job,'retry_scheduled',
      JSONB_BUILD_OBJECT('reason','worker_failure','delay_seconds',delay_seconds));
  END IF;
  UPDATE public.comic_generation_job SET status=next_status,lease_token=NULL,
    lease_expires_at=NULL,attempt_asset_id=NULL,media_asset_id=NULL,output_descriptor=NULL,
    next_attempt_at=now_utc+pg_catalog.make_interval(secs=>delay_seconds),
    error_code=COALESCE(NULLIF(p_error_code,''),'generation_failed'),error_detail=p_error_detail,
    updated_at=now_utc,completed_at=CASE WHEN next_status='failed' THEN now_utc ELSE NULL END
  WHERE id=current_job.id RETURNING * INTO failed;
  UPDATE public.comic_message SET status=next_status,updated_at=now_utc WHERE id=failed.message_id;
  RETURN failed;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_claim_generation_job_for_message(UUID,TEXT,INTEGER),
  public.comic_claim_generation_job(TEXT,INTEGER),
  public.comic_complete_generation_job(UUID,UUID,JSONB,BIGINT,BIGINT),
  public.comic_fail_generation_job(UUID,UUID,TEXT,TEXT,BOOLEAN)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.comic_claim_generation_job_for_message(UUID,TEXT,INTEGER),
  public.comic_claim_generation_job(TEXT,INTEGER),
  public.comic_complete_generation_job(UUID,UUID,JSONB,BIGINT,BIGINT),
  public.comic_fail_generation_job(UUID,UUID,TEXT,TEXT,BOOLEAN) TO service_role;

-- Reconcile historical deployed ACL drift without granting any new capability.
-- Explicit authenticated grants survive; browser roles never call trigger funcs.
DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN SELECT n.nspname,p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
    p.prorettype='pg_catalog.trigger'::pg_catalog.regtype AS is_trigger
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND LEFT(p.proname,6)='comic_' AND p.prosecdef
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC,anon',
      fn.nspname,fn.proname,fn.args);
    IF fn.is_trigger THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM authenticated',
        fn.nspname,fn.proname,fn.args);
    END IF;
  END LOOP;
END;
$$;
