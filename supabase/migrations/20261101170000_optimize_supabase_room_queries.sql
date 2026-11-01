-- Reduce room-list round trips and avoid transferring full word arrays.
-- The generated count keeps items as the single source of truth.

ALTER TABLE public.ei_typebomb_rooms
    ADD COLUMN IF NOT EXISTS item_count integer
    GENERATED ALWAYS AS (
        CASE
            WHEN jsonb_typeof(items) = 'array' THEN jsonb_array_length(items)
            ELSE 0
        END
    ) STORED;

CREATE INDEX IF NOT EXISTS ei_typebomb_rooms_visibility_updated_idx
    ON public.ei_typebomb_rooms (visibility, updated_at DESC);

CREATE INDEX IF NOT EXISTS ei_typebomb_rooms_user_updated_idx
    ON public.ei_typebomb_rooms (user_id, updated_at DESC);

COMMENT ON COLUMN public.ei_typebomb_rooms.item_count IS
    'Generated count of items in the room JSON array.';

CREATE OR REPLACE FUNCTION public.get_ei_typebomb_public_rooms()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $get_public_rooms$
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', rooms.id,
                'title', rooms.title,
                'explanation', rooms.explanation,
                'max_players', rooms.max_players,
                'bomb_count', rooms.bomb_count,
                'created_at', rooms.created_at,
                'updated_at', rooms.updated_at,
                'link', rooms.link,
                'game_duration', rooms.game_duration,
                'item_count', rooms.item_count,
                'play_count', COALESCE(plays.play_count, 0),
                'recent_play_count', COALESCE(plays.recent_play_count, 0),
                'save_count', COALESCE(saves.save_count, 0)
            )
            ORDER BY rooms.updated_at DESC NULLS LAST, rooms.id
        ),
        '[]'::jsonb
    )
    FROM public.ei_typebomb_rooms AS rooms
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*)::bigint AS play_count,
            COUNT(*) FILTER (
                WHERE events.created_at >= now() - interval '7 days'
            )::bigint AS recent_play_count
        FROM public.ei_typebomb_room_play_events AS events
        WHERE events.room_id = rooms.id
    ) AS plays ON true
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::bigint AS save_count
        FROM public.ei_typebomb_saved_rooms AS saved
        WHERE saved.room_id = rooms.id
    ) AS saves ON true
    WHERE rooms.visibility = 'public';
$get_public_rooms$;

REVOKE ALL ON FUNCTION public.get_ei_typebomb_public_rooms()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ei_typebomb_public_rooms()
    TO service_role;

CREATE OR REPLACE FUNCTION public.toggle_ei_typebomb_saved_room(
    p_user_id uuid,
    p_room_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $toggle_saved_room$
DECLARE
    deleted_rows integer;
BEGIN
    IF p_user_id IS NULL OR p_room_id IS NULL THEN
        RAISE EXCEPTION 'User and room IDs are required';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(p_user_id::text || ':' || p_room_id::text, 0)
    );

    DELETE FROM public.ei_typebomb_saved_rooms
    WHERE user_id = p_user_id
      AND room_id = p_room_id;

    GET DIAGNOSTICS deleted_rows = ROW_COUNT;

    IF deleted_rows > 0 THEN
        RETURN false;
    END IF;

    INSERT INTO public.ei_typebomb_saved_rooms (user_id, room_id)
    VALUES (p_user_id, p_room_id)
    ON CONFLICT DO NOTHING;

    RETURN true;
END;
$toggle_saved_room$;

REVOKE ALL ON FUNCTION
    public.toggle_ei_typebomb_saved_room(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.toggle_ei_typebomb_saved_room(uuid, uuid)
    TO service_role;

CREATE OR REPLACE FUNCTION public.record_ei_typebomb_room_play(
    p_room_id uuid,
    p_user_id uuid,
    p_play_mode text
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $record_room_play$
    INSERT INTO public.ei_typebomb_room_play_events (
        room_id,
        user_id,
        play_mode
    )
    SELECT
        rooms.id,
        p_user_id,
        p_play_mode
    FROM public.ei_typebomb_rooms AS rooms
    WHERE rooms.id = p_room_id
      AND rooms.visibility = 'public'
      AND p_play_mode IN ('online', 'offline');
$record_room_play$;

REVOKE ALL ON FUNCTION
    public.record_ei_typebomb_room_play(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.record_ei_typebomb_room_play(uuid, uuid, text)
    TO service_role;
