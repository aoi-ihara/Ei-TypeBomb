-- Restrict manually configured bombs to four. Existing values above four are clamped.
UPDATE public.ei_typebomb_rooms
SET bomb_count = 4
WHERE bomb_count > 4;

ALTER TABLE public.ei_typebomb_rooms
    DROP CONSTRAINT IF EXISTS ei_typebomb_rooms_bomb_count_range;

ALTER TABLE public.ei_typebomb_rooms
    ADD CONSTRAINT ei_typebomb_rooms_bomb_count_range
    CHECK (bomb_count IS NULL OR bomb_count BETWEEN 1 AND 4);

COMMENT ON COLUMN public.ei_typebomb_rooms.bomb_count IS
    'NULL = automatic bomb count; otherwise desired bomb count (1-4), capped by number of players.';
