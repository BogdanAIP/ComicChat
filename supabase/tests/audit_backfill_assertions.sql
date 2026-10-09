DO $$
DECLARE
  pending public.comic_publication_request%ROWTYPE;
  published public.comic_publication_request%ROWTYPE;
  episode public.comic_story_episode%ROWTYPE;
BEGIN
  -- Golden values from TemplateRenderer.stableComicSeed() on ASCII UUIDs.
  IF public.comic_template_character_seed(
    '41414141-1111-4111-8111-111111111111','41414141-aaaa-4aaa-8aaa-aaaaaaaaaaaa',TRUE)<>3631377707
    OR public.comic_template_character_seed(
    '41414141-1111-4111-8111-111111111111','41414141-aaaa-4aaa-8aaa-aaaaaaaaaaaa',FALSE)<>1675906347 THEN
    RAISE EXCEPTION 'frozen character seed does not match private TemplateRenderer';
  END IF;
  SELECT r.* INTO pending FROM public.comic_publication_request r
  WHERE r.requested_by='42424242-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::UUID
    AND r.cancelled_at IS NULL AND NOT EXISTS(
      SELECT 1 FROM public.comic_story_episode e WHERE e.request_id=r.id);
  IF pending.id IS NULL OR JSONB_ARRAY_LENGTH(pending.panels)<>36
    OR pending.panels->0->>'text'<>'Backfill panel 5'
    OR pending.panels->35->>'text'<>'Backfill panel 40' THEN
    RAISE EXCEPTION 'old unpublished request was not bounded/frozen correctly';
  END IF;
  SELECT e.* INTO episode FROM public.comic_story_episode e
  WHERE e.author_id='42424242-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::UUID;
  SELECT r.* INTO published FROM public.comic_publication_request r WHERE r.id=episode.request_id;
  IF episode.id IS NULL OR episode.panels IS DISTINCT FROM published.panels
    OR JSONB_ARRAY_LENGTH(episode.panels)<>3
    OR episode.panels->0->>'text'<>'Backfill panel 1'
    OR episode.panels->0->'character'->>'seed' IS NULL
    OR episode.panels->0->'illustration'<>'null'::JSONB THEN
    RAISE EXCEPTION 'published old snapshot changed or lost frozen character metadata';
  END IF;
  IF EXISTS(SELECT 1 FROM public.comic_publication_request r
    WHERE r.requested_by='42424242-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::UUID
      AND r.cancelled_at IS NOT NULL AND r.panels IS NOT NULL) THEN
    RAISE EXCEPTION 'cancelled old request was resurrected';
  END IF;
END;
$$;
