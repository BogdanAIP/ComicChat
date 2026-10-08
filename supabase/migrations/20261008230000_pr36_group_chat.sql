-- PR-36: ordinary membership-controlled group chats, using existing ComicChat
-- message RPCs, RLS, Realtime broadcast, comic panels and reporting boundaries.
-- No public group comic publishing or adult-group creation is enabled here.

CREATE TABLE IF NOT EXISTS public.comic_group_profile (
  conversation_id UUID PRIMARY KEY REFERENCES public.comic_conversation(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (CHAR_LENGTH(BTRIM(title)) BETWEEN 3 AND 80),
  visibility TEXT NOT NULL CHECK (visibility IN ('closed', 'public')),
  adult_theme BOOLEAN NOT NULL DEFAULT FALSE,
  terms_version INTEGER NOT NULL DEFAULT 1 CHECK (terms_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT comic_group_adult_only_closed CHECK (adult_theme = FALSE OR visibility = 'closed')
);

CREATE TABLE IF NOT EXISTS public.comic_group_invitation (
  conversation_id UUID NOT NULL REFERENCES public.comic_group_profile(conversation_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.comic_group_terms_acceptance (
  conversation_id UUID NOT NULL REFERENCES public.comic_group_profile(conversation_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version INTEGER NOT NULL CHECK (terms_version > 0),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS comic_group_invitation_user_idx
  ON public.comic_group_invitation (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comic_group_terms_user_idx
  ON public.comic_group_terms_acceptance (user_id, accepted_at DESC);

ALTER TABLE public.comic_group_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_group_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comic_group_terms_acceptance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comic_group_profile, public.comic_group_invitation,
  public.comic_group_terms_acceptance FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.comic_create_group(
  p_title TEXT,
  p_visibility TEXT DEFAULT 'closed'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  me UUID := auth.uid();
  group_id UUID;
  name TEXT := BTRIM(COALESCE(p_title,''));
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;
  IF NOT public.comic_account_interaction_allowed(me) THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE='42501';
  END IF;
  IF CHAR_LENGTH(name) NOT BETWEEN 3 AND 80
     OR p_visibility NOT IN ('closed','public') THEN
    RAISE EXCEPTION 'invalid_group_settings' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.comic_conversation(kind,created_by)
  VALUES ('group',me) RETURNING id INTO group_id;
  INSERT INTO public.comic_group_profile(conversation_id,title,visibility)
  VALUES(group_id,name,p_visibility);
  INSERT INTO public.comic_membership(conversation_id,user_id,role)
  VALUES(group_id,me,'owner');
  IF p_visibility='public' THEN
    INSERT INTO public.comic_group_terms_acceptance(
      conversation_id,user_id,terms_version
    ) VALUES(group_id,me,1);
  END IF;
  RETURN group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_invite_group_user(
  p_group_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  me UUID := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;
  IF NOT public.comic_account_interaction_allowed(me) THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.comic_membership AS m
    JOIN public.comic_group_profile AS g ON g.conversation_id=m.conversation_id
    WHERE m.conversation_id=p_group_id AND m.user_id=me
      AND m.role='owner' AND g.visibility='closed'
  ) THEN
    RAISE EXCEPTION 'group_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id=me
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user_id)
     OR NOT public.comic_account_interaction_allowed(p_user_id) THEN
    RAISE EXCEPTION 'invalid_invitee' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.comic_membership
    WHERE conversation_id=p_group_id AND user_id=p_user_id
  ) THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.comic_group_invitation(
    conversation_id,user_id,invited_by
  ) VALUES(p_group_id,p_user_id,me)
  ON CONFLICT(conversation_id,user_id) DO UPDATE SET
    invited_by=EXCLUDED.invited_by,
    created_at=NOW();
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_join_group(
  p_group_id UUID,
  p_accept_public_reuse BOOLEAN DEFAULT FALSE
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  me UUID := auth.uid();
  grp public.comic_group_profile%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;
  IF NOT public.comic_account_interaction_allowed(me) THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO grp FROM public.comic_group_profile
  WHERE conversation_id=p_group_id;
  IF NOT FOUND OR grp.adult_theme THEN
    RAISE EXCEPTION 'group_forbidden' USING ERRCODE='42501';
  END IF;
  IF grp.visibility='closed' AND NOT EXISTS (
    SELECT 1 FROM public.comic_group_invitation
    WHERE conversation_id=p_group_id AND user_id=me
  ) AND NOT EXISTS (
    SELECT 1 FROM public.comic_membership
    WHERE conversation_id=p_group_id AND user_id=me
  ) THEN
    RAISE EXCEPTION 'group_forbidden' USING ERRCODE='42501';
  END IF;
  IF grp.visibility='public' AND p_accept_public_reuse IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'public_group_terms_required' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.comic_membership(conversation_id,user_id,role)
  VALUES (p_group_id,me,'member')
  ON CONFLICT(conversation_id,user_id) DO NOTHING;
  DELETE FROM public.comic_group_invitation
  WHERE conversation_id=p_group_id AND user_id=me;
  IF grp.visibility='public' THEN
    INSERT INTO public.comic_group_terms_acceptance(
      conversation_id,user_id,terms_version
    ) VALUES(p_group_id,me,grp.terms_version)
    ON CONFLICT(conversation_id,user_id) DO UPDATE SET
      terms_version=EXCLUDED.terms_version,accepted_at=NOW();
  END IF;
  RETURN p_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_list_groups()
RETURNS TABLE(
  conversation_id UUID,
  title TEXT,
  visibility TEXT,
  adult_theme BOOLEAN,
  my_role TEXT,
  member_count INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT g.conversation_id,g.title,g.visibility,g.adult_theme,m.role,
    (SELECT COUNT(*)::INTEGER FROM public.comic_membership AS other
     WHERE other.conversation_id=g.conversation_id)
  FROM public.comic_group_profile AS g
  JOIN public.comic_membership AS m ON m.conversation_id=g.conversation_id
  WHERE m.user_id=auth.uid()
  ORDER BY g.created_at DESC,g.conversation_id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_list_group_invitations()
RETURNS TABLE (
  conversation_id UUID,
  title TEXT,
  invited_by_username TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT i.conversation_id,g.title,
    COALESCE(NULLIF(BTRIM(u.username),''),'Group owner'),i.created_at
  FROM public.comic_group_invitation AS i
  JOIN public.comic_group_profile AS g ON g.conversation_id=i.conversation_id
  LEFT JOIN public."user" AS u ON u.id=i.invited_by
  WHERE i.user_id=auth.uid()
  ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_list_group_members(p_group_id UUID)
RETURNS TABLE(user_id UUID,username TEXT,member_role TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.comic_membership
    WHERE conversation_id=p_group_id AND user_id=auth.uid()
  ) THEN
    RAISE EXCEPTION 'group_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT m.user_id,
    COALESCE(NULLIF(BTRIM(u.username),''),'Member'),m.role
  FROM public.comic_membership m
  LEFT JOIN public."user" u ON u.id=m.user_id
  WHERE m.conversation_id=p_group_id
  ORDER BY m.joined_at,m.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.comic_leave_group(p_group_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  me UUID := auth.uid();
  my_role TEXT;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501';
  END IF;
  SELECT m.role INTO my_role FROM public.comic_membership m
  JOIN public.comic_group_profile g ON g.conversation_id=m.conversation_id
  WHERE m.conversation_id=p_group_id AND m.user_id=me;
  IF my_role IS NULL THEN
    RAISE EXCEPTION 'group_forbidden' USING ERRCODE='42501';
  END IF;
  IF my_role='owner' THEN
    RAISE EXCEPTION 'owner_transfer_required' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.comic_membership
  WHERE conversation_id=p_group_id AND user_id=me;
  DELETE FROM public.comic_group_terms_acceptance
  WHERE conversation_id=p_group_id AND user_id=me;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_create_group(TEXT,TEXT),
 public.comic_invite_group_user(UUID,UUID),
 public.comic_join_group(UUID,BOOLEAN),public.comic_list_groups(),
 public.comic_list_group_invitations(),public.comic_list_group_members(UUID),
 public.comic_leave_group(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.comic_create_group(TEXT,TEXT),
 public.comic_invite_group_user(UUID,UUID),
 public.comic_join_group(UUID,BOOLEAN),public.comic_list_groups(),
 public.comic_list_group_invitations(),public.comic_list_group_members(UUID),
 public.comic_leave_group(UUID) TO authenticated;
