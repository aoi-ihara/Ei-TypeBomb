import "server-only";

import type { Room } from "@/type";
import { unstable_rethrow } from "next/navigation";
import { serverError } from "@/lib/server-console";
import {
    getDeploymentCacheNamespace,
    isUpstashConfigured as configured,
    runUpstashCommand as command,
} from "./upstash-rest";

/**
 * The shared cache contains ONLY public room-list summaries: never items,
 * passwords, ownership metadata, private rooms, or unlisted room contents.
 * A generation key fences writes made by requests that began before an edit.
 */
const configuredTtl = Number(process.env.PUBLIC_ROOM_CACHE_TTL_SECONDS ?? 3600);
const TTL_SECONDS =
    Number.isSafeInteger(configuredTtl) && configuredTtl >= 60 && configuredTtl <= 86400
        ? configuredTtl
        : 3600;
let lastWarningAt = 0;

const getPrefix = () => {
    // Preserve the original list-cache namespace (not the room-data fallback).
    const namespace =
        process.env.UPSTASH_CACHE_NAMESPACE ?? getDeploymentCacheNamespace();
    return "etb:public-rooms:v1:" + encodeURIComponent(namespace);
};

const warn = (error: unknown) => {
    if (Date.now() - lastWarningAt < 60_000) return;
    lastWarningAt = Date.now();
    serverError("Upstash public-room cache unavailable; using Supabase", error);
};

const generationKey = () => getPrefix() + ":generation";
const dataKey = (generation: string) =>
    getPrefix() + ":list:" + generation;

// Read generation and its matching payload atomically in one Upstash request.
const READ_SCRIPT = [
    "local generation = redis.call('GET', KEYS[1]) or '0'",
    "local value = redis.call('GET', ARGV[1] .. generation)",
    "return {generation, value or false}",
].join("\n");

type CacheRead = {
    rooms: Room[] | null;
    generation: string | null;
    status: "hit" | "miss" | "disabled" | "unavailable";
};

const asPublicSummaries = (value: unknown): Room[] | null => {
    if (!Array.isArray(value)) return null;
    if (
        !value.every(
            (room) =>
                room &&
                typeof room === "object" &&
                typeof room.id === "string" &&
                room.visibility === "public" &&
                typeof room.itemCount === "number" &&
                Number.isFinite(room.itemCount) &&
                Array.isArray(room.items) &&
                room.items.length === 0,
        )
    ) {
        return null;
    }
    // Drop any unexpected fields from Redis before passing data to callers.
    return (value as Room[]).map((room) => ({
        id: room.id,
        title: room.title,
        explanation: room.explanation,
        maxPlayers: room.maxPlayers,
        bombCount: room.bombCount,
        gameDuration: room.gameDuration,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        items: [],
        itemCount: room.itemCount,
        link: room.link,
        visibility: "public",
    }));
};

export async function readPublicRoomsCache(): Promise<CacheRead> {
    if (!configured())
        return { rooms: null, generation: null, status: "disabled" };

    try {
        const result = await command<[string | number, string | null]>([
            "EVAL", READ_SCRIPT, 1, generationKey(), getPrefix() + ":list:",
        ]);
        if (!Array.isArray(result) || result.length !== 2)
            throw new Error("Invalid public-room cache read");
        const generation = String(result[0]);
        if (!/^\d+$/.test(generation))
            throw new Error("Invalid cache generation");
        const encoded = result[1];
        if (encoded === null)
            return { rooms: null, generation, status: "miss" };
        if (typeof encoded !== "string")
            throw new Error("Unexpected public-room cache entry");
        const rooms = asPublicSummaries(JSON.parse(encoded));
        if (!rooms) throw new Error("Invalid public-room cache contents");
        return { rooms, generation, status: "hit" };
    } catch (error) {
        // Preserve Next.js control-flow exceptions such as dynamic rendering.
        unstable_rethrow(error);
        warn(error);
        return { rooms: null, generation: null, status: "unavailable" };
    }
}

export async function writePublicRoomsCache(
    rooms: Room[],
    generation: string | null,
): Promise<void> {
    // Don't write if Redis was unavailable when the request started. That
    // avoids publishing a potentially stale response after a failed read.
    if (!configured() || generation === null) return;

    try {
        const summaries = asPublicSummaries(rooms);
        if (!summaries) throw new Error("Refusing to cache non-public rooms");
        // The generation is captured BEFORE querying Supabase. A concurrent
        // room edit increments it, so late writers cannot repopulate the
        // currently active cache key after an invalidation.
        await command(["SET", dataKey(generation), JSON.stringify(summaries), "EX", TTL_SECONDS]);
    } catch (error) {
        // Preserve Next.js control-flow exceptions such as dynamic rendering.
        unstable_rethrow(error);
        warn(error);
    }
}

export async function invalidatePublicRoomsCache(): Promise<void> {
    if (!configured()) return;
    try {
        // Generation rather than DEL prevents late, in-flight reads from
        // restoring the stale list after an edit.
        await command(["INCR", generationKey()]);
    } catch (error) {
        // Redis is never the source of truth. Cached summaries are bounded by
        // TTL; edits succeed even if the cache service is temporarily down.
        // Preserve Next.js control-flow exceptions such as dynamic rendering.
        unstable_rethrow(error);
        warn(error);
    }
}
