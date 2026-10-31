-- Expose only the visibility state needed by room listings, never the password itself.
ALTER TABLE public.ei_typebomb_rooms
    ADD COLUMN IF NOT EXISTS is_unlisted boolean
    GENERATED ALWAYS AS (
        is_public IS NOT TRUE AND password IS NULL
    ) STORED;

COMMENT ON COLUMN public.ei_typebomb_rooms.is_unlisted IS
    'True when a room is unlisted: it is not public and has no password.';
