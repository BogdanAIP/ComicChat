-- Apply after PR38, BEFORE audit_fixes, only in the isolated integration DB.
INSERT INTO auth.users(id,email) VALUES
('42424242-aaaa-4aaa-8aaa-aaaaaaaaaaaa','backfill-a@example.test'),
('42424242-bbbb-4bbb-8bbb-bbbbbbbbbbbb','backfill-b@example.test');
INSERT INTO public."user"(id,username,email) VALUES
('42424242-aaaa-4aaa-8aaa-aaaaaaaaaaaa','backfill-alpha','backfill-a@example.test'),
('42424242-bbbb-4bbb-8bbb-bbbbbbbbbbbb','backfill-bravo','backfill-b@example.test')
ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,email=EXCLUDED.email;
DO $$
DECLARE
  a UUID := '42424242-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  b UUID := '42424242-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  conversation UUID;
  mid UUID;
  published_cut UUID;
  cancelled_cut UUID;
  request UUID;
  i INTEGER;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',a::TEXT,FALSE);
  conversation=public.comic_ensure_direct_conversation(b);
  FOR i IN 1..40 LOOP
    PERFORM pg_catalog.set_config('request.jwt.claim.sub',CASE WHEN i%2=0 THEN a::TEXT ELSE b::TEXT END,FALSE);
    SELECT id INTO mid FROM public.comic_send_message(conversation,gen_random_uuid(),'Backfill panel ' || i);
    UPDATE public.comic_message SET created_at='2026-10-01 00:00:00+00'::TIMESTAMPTZ+pg_catalog.make_interval(secs=>i)
    WHERE id=mid;
    IF i=2 THEN cancelled_cut=mid; END IF;
    IF i=3 THEN published_cut=mid; END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',a::TEXT,FALSE);
  PERFORM public.comic_propose_public_snapshot(conversation,mid);
  request=public.comic_propose_public_snapshot(conversation,published_cut);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',b::TEXT,FALSE);
  PERFORM public.comic_set_public_snapshot_consent(request,TRUE);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',a::TEXT,FALSE);
  PERFORM public.comic_release_approved_episode(request,'Pre-audit published episode');
  request=public.comic_propose_public_snapshot(conversation,cancelled_cut);
  PERFORM public.comic_cancel_public_snapshot_request(request);
  -- Keep the global mock queue clear for the existing PR05 test's first claim.
  UPDATE public.comic_generation_job SET status='failed' WHERE conversation_id=conversation;
END;
$$;
