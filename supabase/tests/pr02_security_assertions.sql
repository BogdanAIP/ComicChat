-- ComicChat PR-02 post-migration security assertions.
-- Run after 20261005_pr02_secure_private_chat.sql in a non-production Supabase
-- environment. Any failed invariant raises an exception.

DO $$
DECLARE
    unsafe_grants INTEGER;
    permissive_policies INTEGER;
    unsafe_definers INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO unsafe_grants
    FROM information_schema.role_table_grants
    WHERE grantee = 'authenticated'
      AND table_schema = 'public'
      AND table_name IN (
          'comic_conversation',
          'comic_membership',
          'comic_message',
          'comic_message_receipt'
      )
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

    IF unsafe_grants <> 0 THEN
        RAISE EXCEPTION 'PR02_ASSERT: authenticated has % unsafe direct table grants', unsafe_grants;
    END IF;

    IF NOT has_table_privilege('authenticated', 'public.comic_membership', 'SELECT') THEN
        RAISE EXCEPTION 'PR02_ASSERT: authenticated needs RLS-filtered SELECT on own comic_membership';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'comic_membership'
          AND policyname = 'comic_membership_select_own'
          AND COALESCE(qual, '') LIKE '%auth.uid()%'
    ) THEN
        RAISE EXCEPTION 'PR02_ASSERT: own-membership RLS policy is missing';
    END IF;

    IF NOT has_table_privilege('authenticated', 'public.comic_message', 'SELECT') THEN
        RAISE EXCEPTION 'PR02_ASSERT: authenticated needs RLS-filtered SELECT on comic_message';
    END IF;

    SELECT COUNT(*)
    INTO permissive_policies
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename LIKE 'comic_%'
      AND (
          COALESCE(qual, '') ~* '^\\s*true\\s*$'
          OR COALESCE(with_check, '') ~* '^\\s*true\\s*$'
      );

    IF permissive_policies <> 0 THEN
        RAISE EXCEPTION 'PR02_ASSERT: found % permissive ComicChat RLS policies', permissive_policies;
    END IF;

    SELECT COUNT(*)
    INTO unsafe_definers
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'comic_%'
      AND p.prosecdef
      AND NOT EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS setting
          WHERE setting LIKE 'search_path=%'
      );

    IF unsafe_definers <> 0 THEN
        RAISE EXCEPTION 'PR02_ASSERT: found % SECURITY DEFINER functions without fixed search_path', unsafe_definers;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'comic_message_conversation_id_sender_id_client_nonce_key'
    ) THEN
        RAISE EXCEPTION 'PR02_ASSERT: message idempotency unique constraint is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'realtime'
          AND tablename = 'messages'
          AND policyname = 'comicchat_receive_broadcast'
          AND cmd = 'SELECT'
          AND COALESCE(qual, '') LIKE '%broadcast%'
          AND COALESCE(qual, '') LIKE '%comic_membership%'
    ) THEN
        RAISE EXCEPTION 'PR02_ASSERT: private Broadcast receive policy is missing';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'realtime'
          AND tablename = 'messages'
          AND cmd = 'INSERT'
          AND roles @> ARRAY['authenticated']::NAME[]
    ) THEN
        RAISE EXCEPTION 'PR02_ASSERT: authenticated clients must not send ComicChat Broadcasts directly';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname = 'comic_membership_broadcast_insert'
    ) THEN
        RAISE EXCEPTION 'PR02_ASSERT: membership Broadcast trigger is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname = 'comic_message_broadcast_change'
    ) THEN
        RAISE EXCEPTION 'PR02_ASSERT: message Broadcast trigger is missing';
    END IF;

    RAISE NOTICE 'PR02_ASSERT: secure private chat checks passed';
END
$$;
