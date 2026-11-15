import "server-only";

import type { Item } from "@/type";
import { serverError } from "@/lib/server-console";
import { unstable_rethrow } from "next/navigation";
import { randomUUID } from "node:crypto";
import {
    getDeploymentCacheNamespace,
    isUpstashConfigured as configured,
    runUpstashCommand as command,
} from "./upstash-rest";

/**
 * Room content shared between visitors, never an authenticated view or an
 * editable record. Passwords and private rooms must never enter this cache.
 * Editor reads and join authorization continue to query Supabase directly.
 */
export type CacheableRoomData = {
    id: string;
    title: string | null;
    user_id: string | null;
    explanation: string | null;
    max_players: number | null;
    bomb_count: number | null;
    created_at: string | null;
    updated_at: string | null;
    items: Item[];
    link: string | null;
    game_duration: number | null;
    visibility: "public" | "unlisted";
};

const rawTtl = Number(process.env.ROOM_DATA_CACHE_TTL_SECONDS ?? 86400);
const TTL_SECONDS =
    Number.isSafeInteger(rawTtl) && rawTtl >= 60 && rawTtl <= 86400
        ? rawTtl
        : 86400;
let lastWarningAt = 0;

const prefix = () => {
    // Room content must retain its database-aware fallback namespace.
    const namespace =
        process.env.UPSTASH_CACHE_NAMESPACE ??
        (process.env.NEXT_PUBLIC_SUPABASE_URL
            ? "db:" + process.env.NEXT_PUBLIC_SUPABASE_URL
            : getDeploymentCacheNamespace());
    return "etb:room-data:v1:" + encodeURIComponent(namespace) + ":";
};

const baseKey = (identifier: string) => prefix() + encodeURIComponent(identifier);
const generationKey = (identifier: string) => baseKey(identifier) + ":generation";
const dataKey = (identifier: string, generation: string) =>
    baseKey(identifier) + ":data:" + generation;

function warn(error: unknown) {
    if (Date.now() - lastWarningAt < 60_000) return;
    lastWarningAt = Date.now();
    serverError("Upstash room-data cache unavailable; using Supabase", error);
}

const optionalString = (value: unknown): value is string | null =>
    value === null || typeof value === "string";
const optionalNumber = (value: unknown): value is number | null =>
    value === null || (typeof value === "number" && Number.isFinite(value));

/** Strip unexpected fields before writing to Redis or returning cached data. */
export function toCacheableRoomData(value: unknown): CacheableRoomData | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (
        typeof row.id !== "string" ||
        (row.visibility !== "public" && row.visibility !== "unlisted") ||
        !optionalString(row.title) ||
        !optionalString(row.user_id) ||
        !optionalString(row.explanation) ||
        !optionalNumber(row.max_players) ||
        !optionalNumber(row.bomb_count) ||
        !optionalString(row.created_at) ||
        !optionalString(row.updated_at) ||
        !optionalString(row.link) ||
        !optionalNumber(row.game_duration) ||
        !Array.isArray(row.items)
    ) {
        return null;
    }
    return {
        id: row.id,
        title: row.title,
        user_id: row.user_id,
        explanation: row.explanation,
        max_players: row.max_players,
        bomb_count: row.bomb_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
        items: row.items as Item[],
        link: row.link,
        game_duration: row.game_duration,
        visibility: row.visibility,
    };
}

type RoomCacheRead = {
    room: CacheableRoomData | null;
    generation: string | null;
    status: "hit" | "miss" | "blocked" | "disabled" | "unavailable";
};

export async function readRoomDataCache(identifier: string): Promise<RoomCacheRead> {
    if (!configured())
        return { room: null, generation: null, status: "disabled" };

    try {
        const rawGeneration = await command<string | number>([
            "GET",
            generationKey(identifier),
        ]);
        const generation = rawGeneration === null ? "0" : String(rawGeneration);
        // A restricted/deleted room is fenced before the DB mutation.
        // No cached content may be read or written until invalidation succeeds.
        if (generation.startsWith("blocked:"))
            return { room: null, generation: null, status: "blocked" };
        if (!/^(?:\d+|[0-9a-f-]{36})$/.test(generation))
            throw new Error("Invalid room cache generation");
        const encoded = await command<string>([
            "GET",
            dataKey(identifier, generation),
        ]);
        if (encoded === null)
            return { room: null, generation, status: "miss" };
        if (typeof encoded !== "string")
            throw new Error("Unexpected room cache entry");
        const room = toCacheableRoomData(JSON.parse(encoded));
        if (!room) throw new Error("Invalid room cache contents");
        return { room, generation, status: "hit" };
    } catch (error) {
        unstable_rethrow(error);
        warn(error);
        return { room: null, generation: null, status: "unavailable" };
    }
}

export async function writeRoomDataCache(
    identifier: string,
    room: unknown,
    generation: string | null,
): Promise<void> {
    if (!configured() || generation === null) return;
    try {
        const data = toCacheableRoomData(room);
        if (!data) return; // Never cache private rooms or invalid payloads.
        // The generation was read BEFORE the DB request. A concurrent edit
        // fences this late write into an obsolete key.
        await command([
            "SET",
            dataKey(identifier, generation),
            JSON.stringify(data),
            "EX",
            TTL_SECONDS,
        ]);
    } catch (error) {
        unstable_rethrow(error);
        warn(error);
    }
}

// EVAL is atomic: an unrelated edit must never clear an active privacy fence.
const UPDATE_IF_UNBLOCKED_SCRIPT = [
    "local old = redis.call('GET', KEYS[1])",
    "if old and string.sub(old, 1, 8) == 'blocked:' then return 0 end",
    "redis.call('SET', KEYS[1], ARGV[1])",
    "return 1",
].join("\n");
const RELEASE_SCRIPT = [
    "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end",
    "redis.call('SET', KEYS[1], ARGV[2])",
    "return 1",
].join("\n");

/**
 * Install a unique privacy fence before changing visibility/deleting.
 * Returns a token that ONLY the same mutation may release. Existing fences
 * cannot be overwritten; on partial failure, any installed fences remain
 * blocked (safe fail-closed) until explicitly released.
 */
export async function blockRoomDataCache(
    ...identifiers: Array<string | null | undefined>
): Promise<string | null> {
    if (!configured()) return null;
    const token = "blocked:" + randomUUID();
    try {
        for (const identifier of new Set(identifiers.filter((id): id is string => !!id))) {
            const changed = await command<number>([
                "EVAL", UPDATE_IF_UNBLOCKED_SCRIPT, 1, generationKey(identifier), token,
            ]);
            if (changed !== 1) throw new Error("Room cache is already privacy-fenced");
        }
        return token;
    } catch (error) {
        unstable_rethrow(error);
        warn(error);
        throw new Error("Room cache protection is unavailable", { cause: error });
    }
}

/** Release only fences owned by this mutation; unrelated blocks are retained. */
export async function releaseRoomDataCache(
    token: string | null,
    ...identifiers: Array<string | null | undefined>
): Promise<void> {
    if (!configured() || !token) return;
    for (const identifier of new Set(identifiers.filter((id): id is string => !!id))) {
        try {
            await command([
                "EVAL", RELEASE_SCRIPT, 1, generationKey(identifier),
                token, randomUUID(),
            ]);
        } catch (error) {
            unstable_rethrow(error);
            warn(error);
        }
    }
}

/** Non-restrictive edits never clear another mutation's privacy fence. */
export async function invalidateRoomDataCache(
    ...identifiers: Array<string | null | undefined>
): Promise<void> {
    if (!configured()) return;
    for (const identifier of new Set(identifiers.filter((id): id is string => !!id))) {
        try {
            await command([
                "EVAL", UPDATE_IF_UNBLOCKED_SCRIPT, 1, generationKey(identifier),
                randomUUID(),
            ]);
        } catch (error) {
            unstable_rethrow(error);
            warn(error);
        }
    }
}
