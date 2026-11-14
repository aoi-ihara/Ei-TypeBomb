import type { createAdminClient } from "../db/server";
import type { Item } from "../../type";
import { prepareItemReadings } from "./readings";

export async function prepareRoomUpdate(
    db: Awaited<ReturnType<typeof createAdminClient>>,
    id: string,
    userId: string,
    items?: Item[],
    expectedVersion?: number,
) {
    const { data, error } = await db.from("ei_typebomb_rooms")
        .select("items, edit_version").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error || !data) return { status: "error" } as const;
    if (expectedVersion !== undefined && data.edit_version !== expectedVersion) {
        return { status: "conflict" } as const;
    }
    const stored = data.items ?? [];
    return {
        status: "ready",
        items: await prepareItemReadings(items ?? stored, stored),
        editVersion: data.edit_version as number,
    } as const;
}
