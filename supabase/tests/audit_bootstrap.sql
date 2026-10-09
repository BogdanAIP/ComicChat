-- Plain PostgreSQL test-only bootstrap, extracted from the CI auth/realtime
-- harness. Use ONLY in a new isolated database, never connected Supabase.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE SCHEMA realtime;
CREATE TABLE realtime.messages(extension TEXT);
CREATE FUNCTION realtime.topic() RETURNS TEXT LANGUAGE sql STABLE
AS 'SELECT pg_catalog.current_setting(''realtime.topic'',true)';
CREATE FUNCTION realtime.send(payload JSONB,event TEXT,topic TEXT,private BOOLEAN DEFAULT TRUE)
RETURNS VOID LANGUAGE sql AS 'SELECT pg_catalog.pg_sleep(0)';
CREATE TABLE auth.users(id UUID PRIMARY KEY,email TEXT);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::UUID
$$;
GRANT USAGE ON SCHEMA public TO authenticated,service_role;
