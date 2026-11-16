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

// Keep this ceiling in sync with the accepted ROOM_DATA_CACHE_TTL_SECONDS range.
// A prior deployment may have written entries with a longer TTL than the current
// setting, while sharing the same Redis namespace.
const MAX_DATA_TTL_SECONDS = 86400;
const rawTtl = Number(process.env.ROOM_DATA_CACHE_TTL_SECONDS ?? MAX_DATA_TTL_SECONDS);
const TTL_SECONDS =
    Number.isSafeInteger(rawTtl) && rawTtl >= 60 && rawTtl <= MAX_DATA_TTL_SECONDS
        ? rawTtl
        : MAX_DATA_TTL_SECONDS;
// Even if the configured TTL is lowered, an orphaned fence may expire only
// after every entry written by a previous supported deployment has expired.
const FENCE_TTL_SECONDS = MAX_DATA_TTL_SECONDS + 60;
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

// Resolve the active generation and data within one atomic Redis execution.
const READ_SCRIPT = [
    "local generation = redis.call('GET', KEYS[1]) or '0'",
    "if string.sub(generation, 1, 8) == 'blocked:' then return {generation, false} end",
    "local data = redis.call('GET', ARGV[1] .. generation)",
    "return {generation, data or false}",
].join("\n");

export async function readRoomDataCache(identifier: string): Promise<RoomCacheRead> {
    if (!configured())
        return { room: null, generation: null, status: "disabled" };

    try {
        const result = await command<[string | number, string | null]>([
            "EVAL", READ_SCRIPT, 1, generationKey(identifier),
            baseKey(identifier) + ":data:",
        ]);
        if (!Array.isArray(result) || result.length !== 2)
            throw new Error("Invalid room cache read");
        const generation = String(result[0]);
        // A restricted/deleted room is fenced before the DB mutation.
        // No cached content may be read or written until invalidation succeeds.
        if (generation.startsWith("blocked:"))
            return { room: null, generation: null, status: "blocked" };
        if (!/^(?:\d+|[0-9a-f-]{36})$/.test(generation))
            throw new Error("Invalid room cache generation");
        const encoded = result[1];
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
        // A late DB read must never restore an obsolete generation after
        // a privacy fence was installed.
        await command([
            "EVAL", WRITE_IF_CURRENT_SCRIPT, 2,
            generationKey(identifier), dataKey(identifier, generation),
            generation, JSON.stringify(data), TTL_SECONDS,
        ]);
    } catch (error) {
        unstable_rethrow(error);
        warn(error);
    }
}

// Check generation and store in one atomic operation, so a delayed read
// cannot repopulate data while a privacy fence is active.
const WRITE_IF_CURRENT_SCRIPT = [
    "local current = redis.call('GET', KEYS[1]) or '0'",
    "if current ~= ARGV[1] then return 0 end",
    "redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[3]))",
    "return 1",
].join("\n");

// Fence all identifiers together or none at all. A lost HTTP response
// cannot strand an indefinite block because fences expire after cache data.
const BLOCK_SCRIPT = [
    "for index = 1, #KEYS do",
    "    local current = redis.call('GET', KEYS[index])",
    "    if current and string.sub(current, 1, 8) == 'blocked:' then return 0 end",
    "end",
    "for index = 1, #KEYS do",
    "    redis.call('SET', KEYS[index], ARGV[1], 'EX', tonumber(ARGV[2]))",
    "end",
    "return 1",
].join("\n");

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
 * cannot be overwritten; aliases are acquired atomically and an orphaned
 * fence expires only after older cached payloads are guaranteed to expire.
 */
export async function blockRoomDataCache(
    ...identifiers: Array<string | null | undefined>
): Promise<string | null> {
    if (!configured()) return null;
    const uniqueIdentifiers = [...new Set(identifiers.filter((id): id is string => !!id))];
    if (!uniqueIdentifiers.length) return null;
    const token = "blocked:" + randomUUID();
    try {
        const changed = await command<number>([
            "EVAL", BLOCK_SCRIPT, uniqueIdentifiers.length,
            ...uniqueIdentifiers.map(generationKey), token, FENCE_TTL_SECONDS,
        ]);
        if (changed !== 1) throw new Error("Room cache is already privacy-fenced");
        return token;
    } catch (error) {
        unstable_rethrow(error);
        // A timed-out request can still commit on Redis. Recover by token
        // when possible; expiry handles outages that persist after this call.
        await releaseRoomDataCache(token, ...uniqueIdentifiers);
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
