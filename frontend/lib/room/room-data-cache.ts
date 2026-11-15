import "server-only";

import type { Item } from "@/type";
import { serverError } from "@/lib/server-console";
import { unstable_rethrow } from "next/navigation";
import { randomUUID } from "node:crypto";

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
const TIMEOUT_MS = 1000;
let lastWarningAt = 0;

const configured = () =>
    Boolean(
        process.env.UPSTASH_REDIS_REST_URL &&
            process.env.UPSTASH_REDIS_REST_TOKEN,
    );

const prefix = () => {
    const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "local";
    const branch =
        environment === "preview"
            ? ":" + (process.env.VERCEL_GIT_COMMIT_REF ?? "default")
            : "";
    // Privacy invalidation must cross preview/production if they point to the
    // same Supabase database. Default to database identity, not deployment.
    const namespace =
        process.env.UPSTASH_CACHE_NAMESPACE ??
        (process.env.NEXT_PUBLIC_SUPABASE_URL
            ? "db:" + process.env.NEXT_PUBLIC_SUPABASE_URL
            : environment + branch);
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

async function command<T>(args: (string | number)[]): Promise<T | null> {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error("Upstash is not configured");
    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("Upstash HTTP " + response.status);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object")
        throw new Error("Invalid Upstash response");
    const record = body as { result?: unknown; error?: string };
    if (record.error) throw new Error("Upstash command failed");
    if (!("result" in record)) throw new Error("Missing Upstash result");
    return record.result as T | null;
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

/**
 * Fail closed before revoking public access or deleting a room. If Redis is
 * configured but this write fails, the mutation must not proceed: otherwise
 * previously public questions could remain readable for the full cache TTL.
 * The blocked generation is safe to leave behind if the following DB write
 * fails or cache invalidation is unavailable: readers bypass Redis.
 */
export async function blockRoomDataCache(
    ...identifiers: Array<string | null | undefined>
): Promise<void> {
    if (!configured()) return;
    try {
        for (const identifier of new Set(identifiers.filter((id): id is string => !!id))) {
            await command(["SET", generationKey(identifier), "blocked:" + randomUUID()]);
        }
    } catch (error) {
        unstable_rethrow(error);
        warn(error);
        throw new Error("Room cache protection is unavailable", { cause: error });
    }
}

/** Invalidate canonical, legacy-ID and old-link entries after a mutation. */
export async function invalidateRoomDataCache(
    ...identifiers: Array<string | null | undefined>
): Promise<void> {
    if (!configured()) return;
    for (const identifier of new Set(identifiers.filter((id): id is string => !!id))) {
        try {
            // A random generation cannot be reused by an in-flight stale read.
            await command(["SET", generationKey(identifier), randomUUID()]);
        } catch (error) {
            unstable_rethrow(error);
            warn(error);
        }
    }
}
