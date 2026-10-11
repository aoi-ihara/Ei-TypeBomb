import type { Room } from "./types";

/** Database columns shared by the Node and Cloudflare room loaders. */
export type RoomRow = {
    id: string;
    title: string | null;
    user_id: string | null;
    explanation: string | null;
    max_players: number | null;
    game_duration: number | null;
    password?: string | null;
    created_at: string | null;
    updated_at: string | null;
    items: Room["items"] | null;
};

export function roomFromRow(data: RoomRow): Room {
    return {
        id: data.id,
        title: data.title ?? undefined,
        userId: data.user_id ?? undefined,
        explanation: data.explanation ?? undefined,
        maxPlayers: data.max_players ?? undefined,
        gameDuration: data.game_duration ?? 20,
        password: data.password,
        createdAt: data.created_at ?? undefined,
        updatedAt: data.updated_at ?? undefined,
        items: data.items ?? [],
        users: [],
        isStart: false,
        bombHolder: 0,
        bombStatus: 0,
    };
}
