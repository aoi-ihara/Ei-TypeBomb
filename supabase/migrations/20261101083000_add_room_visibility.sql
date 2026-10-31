-- Use one explicit value for the room's visibility.
-- Existing rooms are migrated from the previous is_public/password combination.
ALTER TABLE public.ei_typebomb_rooms
    ADD COLUMN visibility text;

-- Empty passwords are treated as unset, matching the application's previous Boolean(password) check.
UPDATE public.ei_typebomb_rooms
SET password = NULL
WHERE password = '';

UPDATE public.ei_typebomb_rooms
SET visibility = CASE
    WHEN is_public IS TRUE THEN 'public'
    WHEN password IS NULL THEN 'unlisted'
    ELSE 'private'
END;

-- New rooms are unlisted by default, matching the room creation flow.
ALTER TABLE public.ei_typebomb_rooms
    ALTER COLUMN visibility SET DEFAULT 'unlisted',
    ALTER COLUMN visibility SET NOT NULL;

ALTER TABLE public.ei_typebomb_rooms
    ADD CONSTRAINT ei_typebomb_rooms_visibility_password_check
    CHECK (
        visibility IN ('public', 'unlisted', 'private')
        AND (
            (visibility IN ('public', 'unlisted') AND password IS NULL)
            OR (visibility = 'private' AND password IS NOT NULL)
        )
    );

COMMENT ON COLUMN public.ei_typebomb_rooms.visibility IS
    'Room visibility: public, unlisted, or private.';

-- is_public is no longer needed once visibility has been backfilled.
ALTER TABLE public.ei_typebomb_rooms
    DROP COLUMN is_public;
