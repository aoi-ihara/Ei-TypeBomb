-- Use one explicit value for the room's visibility.
-- Existing rooms are migrated from the previous is_public/password combination.
ALTER TABLE public.ei_typebomb_rooms
    ADD COLUMN visibility text;

-- Empty passwords are treated as unset, matching the application's previous Boolean(password) check.
UPDATE public.ei_typebomb_rooms
SET password = NULL
WHERE password = '' OR is_public IS TRUE;

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

-- Keep legacy clients compatible while deployments roll forward.
-- Application code uses visibility as the source of truth; this trigger only
-- translates writes made by older clients that still update is_public/password.
CREATE OR REPLACE FUNCTION public.sync_ei_typebomb_room_visibility_legacy()
RETURNS trigger
LANGUAGE plpgsql
AS $visibility_migration$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.is_public IS TRUE THEN
            NEW.visibility := 'public';
            NEW.password := NULL;
        ELSIF NEW.password IS NOT NULL THEN
            NEW.visibility := 'private';
        ELSE
            NEW.visibility := COALESCE(NEW.visibility, 'unlisted');
        END IF;
    ELSIF NEW.visibility IS NOT DISTINCT FROM OLD.visibility
        AND (
            NEW.is_public IS DISTINCT FROM OLD.is_public
            OR NEW.password IS DISTINCT FROM OLD.password
        )
    THEN
        IF NEW.is_public IS TRUE THEN
            NEW.visibility := 'public';
            NEW.password := NULL;
        ELSIF NEW.password IS NULL THEN
            NEW.visibility := 'unlisted';
        ELSE
            NEW.visibility := 'private';
        END IF;
    END IF;

    RETURN NEW;
END;
$visibility_migration$;

CREATE TRIGGER ei_typebomb_rooms_sync_visibility_legacy
BEFORE INSERT OR UPDATE OF is_public, password, visibility
ON public.ei_typebomb_rooms
FOR EACH ROW
EXECUTE FUNCTION public.sync_ei_typebomb_room_visibility_legacy();

-- Keep is_public temporarily for rollback compatibility.
-- New application code uses visibility as the source of truth and mirrors is_public on updates.
