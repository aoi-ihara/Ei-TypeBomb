import "server-only";

import type { Room } from "@/type";

export type RoomRecommendationStats = {
    playCount: number;
    recentPlayCount: number;
    saveCount: number;
};

type RecommendableRoom = Pick<
    Room,
    "id" | "createdAt" | "title" | "explanation" | "itemCount"
>;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Stable daily variation keeps recommendations fresh without changing on every render. */
const hashToUnitInterval = (value: string): number => {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0) / 0xffffffff;
};

/**
 * Rank public rooms using inexpensive, explainable signals:
 * popularity, recent activity, room freshness, content completeness, and
 * a small deterministic daily exploration score.
 *
 * This module is server-only because recommendation statistics are resolved
 * before the ordered room list is passed to the client.
 */
export const rankPublicRooms = <T extends RecommendableRoom>(
    rooms: T[],
    statsByRoomId: ReadonlyMap<string, RoomRecommendationStats>,
    now = new Date(),
): T[] => {
    const dayKey = now.toISOString().slice(0, 10);

    return rooms
        .map((room) => {
            const stats = statsByRoomId.get(room.id);
            const playCount = Math.max(0, stats?.playCount ?? 0);
            const recentPlayCount = Math.max(
                0,
                stats?.recentPlayCount ?? 0,
            );
            const saveCount = Math.max(0, stats?.saveCount ?? 0);

            const createdAt = room.createdAt
                ? new Date(room.createdAt).getTime()
                : Number.NaN;
            const ageDays = Number.isFinite(createdAt)
                ? Math.max(0, (now.getTime() - createdAt) / DAY_IN_MS)
                : 30;

            const popularityScore =
                Math.log1p(playCount) * 2.5 +
                Math.log1p(saveCount) * 5;
            const activityScore = Math.log1p(recentPlayCount) * 4;
            const freshnessScore = 8 * Math.exp(-ageDays / 14);
            const itemCount = Math.max(0, room.itemCount ?? 0);
            const completenessScore =
                (room.title?.trim() ? 1 : 0) +
                (room.explanation?.trim() ? 0.5 : 0) +
                (itemCount >= 5 ? 1.5 : itemCount >= 2 ? 0.75 : 0);
            const explorationScore =
                hashToUnitInterval(dayKey + ":" + room.id) * 2.5;

            return {
                room,
                score:
                    popularityScore +
                    activityScore +
                    freshnessScore +
                    completenessScore +
                    explorationScore,
                explorationScore,
            };
        })
        .sort(
            (a, b) =>
                b.score - a.score ||
                b.explorationScore - a.explorationScore ||
                a.room.id.localeCompare(b.room.id),
        )
        .map(({ room }) => room);
};
