import { ROOM_SELECT_COLUMNS, roomFromRow, type RoomRow } from "../../../shared/room";
import type { Room } from "../../../shared/types";
import type { Env } from "../types";

/** RLS-scoped PostgREST fetch, using the user's verified room JWT. No role key. */
export async function loadRoom(
    id: string,
    jwtToken: string,
    env: Env,
): Promise<Room | null> {
    if (!env.NEXT_PUBLIC_SUPABASE_URL ||
        !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        throw new Error("Supabase environment variables are missing");
    }
    const url = new URL(
        "/rest/v1/ei_typebomb_rooms",
        env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "") + "/",
    );
    url.searchParams.set("id", "eq." + id);
    url.searchParams.set("select", ROOM_SELECT_COLUMNS.replace(/\s/g, ""));
    url.searchParams.set("limit", "1");
    const response = await fetch(url, {
        headers: {
            apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${jwtToken}`,
            Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Room lookup failed");
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return roomFromRow(rows[0] as RoomRow);
}
