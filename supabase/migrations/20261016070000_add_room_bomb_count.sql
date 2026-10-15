-- NULL preserves the existing automatic count for existing and new rooms.
ALTER TABLE public.ei_typebomb_rooms
    ADD COLUMN IF NOT EXISTS bomb_count smallint DEFAULT NULL;

ALTER TABLE public.ei_typebomb_rooms
    ADD CONSTRAINT ei_typebomb_rooms_bomb_count_range
    CHECK (bomb_count IS NULL OR bomb_count BETWEEN 1 AND 16);

COMMENT ON COLUMN public.ei_typebomb_rooms.bomb_count IS
    'NULL = automatic bomb count; otherwise desired bomb count capped by number of players.';
