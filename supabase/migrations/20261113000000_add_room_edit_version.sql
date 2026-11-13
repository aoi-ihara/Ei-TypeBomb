-- Increment the room revision on every write, including MCP and legacy updates.
-- The editor can then compare and swap atomically without relying on timestamp resolution.
ALTER TABLE public.ei_typebomb_rooms
    ADD COLUMN edit_version bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.bump_ei_typebomb_room_edit_version()
RETURNS trigger
LANGUAGE plpgsql
AS $revision$
BEGIN
    NEW.edit_version := OLD.edit_version + 1;
    RETURN NEW;
END;
$revision$;

CREATE TRIGGER ei_typebomb_rooms_bump_edit_version
BEFORE UPDATE ON public.ei_typebomb_rooms
FOR EACH ROW
EXECUTE FUNCTION public.bump_ei_typebomb_room_edit_version();

COMMENT ON COLUMN public.ei_typebomb_rooms.edit_version IS
    'Monotonic revision used for optimistic concurrency control in the room editor.';
