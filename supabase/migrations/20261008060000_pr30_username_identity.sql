-- ComicChat PR-30: username identity boundary for closed beta.
--
-- Usernames are the human-readable discovery key in ComicChat. Keep profile
-- rows private/self-only, but make non-null usernames valid and unambiguous.

UPDATE public."user"
SET username = BTRIM(username)
WHERE username IS NOT NULL
  AND username IS DISTINCT FROM BTRIM(username);

UPDATE public."user"
SET username = NULL
WHERE username IS NOT NULL
  AND (
    CHAR_LENGTH(username) < 2
    OR CHAR_LENGTH(username) > 32
  );

ALTER TABLE public."user"
    DROP CONSTRAINT IF EXISTS comic_user_username_valid;

ALTER TABLE public."user"
    ADD CONSTRAINT comic_user_username_valid
    CHECK (
      username IS NULL
      OR (
        username = BTRIM(username)
        AND CHAR_LENGTH(username) BETWEEN 2 AND 32
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS comic_user_username_lower_unique
    ON public."user" (LOWER(username))
    WHERE username IS NOT NULL;
