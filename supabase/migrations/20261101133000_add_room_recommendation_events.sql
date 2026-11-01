-- Persist successful entries into public rooms for the recommendation ranking.
-- Anonymous plays are counted too; user_id is only populated for signed-in users.
CREATE TABLE IF NOT EXISTS public.ei_typebomb_room_play_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id uuid NOT NULL
        REFERENCES public.ei_typebomb_rooms(id) ON DELETE CASCADE,
    user_id uuid
        REFERENCES auth.users(id) ON DELETE SET NULL,
    play_mode text NOT NULL
        CONSTRAINT ei_typebomb_room_play_events_play_mode_check
        CHECK (play_mode IN ('online', 'offline')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ei_typebomb_room_play_events_room_created_idx
    ON public.ei_typebomb_room_play_events (room_id, created_at DESC);

-- The existing saved-room table is queried by room_id in the aggregate below.
CREATE INDEX IF NOT EXISTS ei_typebomb_saved_rooms_room_id_idx
    ON public.ei_typebomb_saved_rooms (room_id);

ALTER TABLE public.ei_typebomb_room_play_events ENABLE ROW LEVEL SECURITY;

-- Only the server-side service-role client may write play events.
REVOKE ALL ON TABLE public.ei_typebomb_room_play_events
    FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.ei_typebomb_room_play_events TO service_role;
GRANT USAGE, SELECT
    ON SEQUENCE public.ei_typebomb_room_play_events_id_seq
    TO service_role;

-- Return aggregates only; individual play records are never exposed to the client.
CREATE OR REPLACE FUNCTION public.get_ei_typebomb_public_room_recommendation_stats(
    p_room_ids uuid[]
)
RETURNS TABLE (
    room_id uuid,
    play_count bigint,
    recent_play_count bigint,
    save_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $recommendation_stats$
    SELECT
        rooms.id AS room_id,
        COALESCE(plays.play_count, 0)::bigint AS play_count,
        COALESCE(plays.recent_play_count, 0)::bigint AS recent_play_count,
        COALESCE(saves.save_count, 0)::bigint AS save_count
    FROM public.ei_typebomb_rooms AS rooms
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*) AS play_count,
            COUNT(*) FILTER (
                WHERE events.created_at >= now() - interval '7 days'
            ) AS recent_play_count
        FROM public.ei_typebomb_room_play_events AS events
        WHERE events.room_id = rooms.id
    ) AS plays ON true
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS save_count
        FROM public.ei_typebomb_saved_rooms AS saved
        WHERE saved.room_id = rooms.id
    ) AS saves ON true
    WHERE rooms.visibility = 'public'
      AND (p_room_ids IS NULL OR rooms.id = ANY(p_room_ids));
$recommendation_stats$;

REVOKE ALL ON FUNCTION
    public.get_ei_typebomb_public_room_recommendation_stats(uuid[])
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    public.get_ei_typebomb_public_room_recommendation_stats(uuid[])
    TO service_role;
