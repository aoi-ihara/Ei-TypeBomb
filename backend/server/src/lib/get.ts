import { roomDatabase } from "./db";
import { roomFromRow, type RoomRow } from "../../../shared/room";

export const getRoomFromId = async (id: string) => {
    try {
        const { rows } = await roomDatabase.query<RoomRow>(
            `SELECT
                id,
                title,
                user_id,
                explanation,
                max_players,
                game_duration,
                password,
                created_at,
                updated_at,
                items
            FROM public.ei_typebomb_rooms
            WHERE id = $1
            LIMIT 1`,
            [id],
        );

        const data = rows[0];
        if (!data) return;

        return roomFromRow(data);
    } catch (error) {
        console.error(
            "Failed to read room from PostgreSQL:",
            error instanceof Error ? error.message : error,
        );
        return;
    }
};
