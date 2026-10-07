-- ComicChat PR-18: make private Realtime Broadcast receive-only for clients.
--
-- Supabase Realtime authorizes client Broadcast sends through INSERT policies
-- on realtime.messages. A permissive platform/default INSERT policy can
-- therefore make channel.send() succeed even when ComicChat itself created no
-- INSERT policy. This restrictive policy is defense in depth: for anon and
-- authenticated client roles every Broadcast/Presence insert authorization
-- check is denied. Database-triggered realtime.send() runs outside these client
-- roles and remains the only ComicChat Broadcast production path.

DROP POLICY IF EXISTS comicchat_deny_client_realtime_insert
    ON realtime.messages;

CREATE POLICY comicchat_deny_client_realtime_insert
    ON realtime.messages
    AS RESTRICTIVE
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (FALSE);
