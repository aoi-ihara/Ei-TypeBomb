import "server-only";

import type { Room } from "@/type";
import { unstable_rethrow } from "next/navigation";
import { serverError } from "@/lib/server-console";

/**
 * The shared cache contains ONLY public room-list summaries: never items,
 * passwords, ownership metadata, private rooms, or unlisted room contents.
 * A generation key fences writes made by requests that began before an edit.
 */
const TTL_SECONDS = 120;
const TIMEOUT_MS = 1000;
let lastWarningAt = 0;

const getPrefix = () => {
    const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "local";
    const branch =
        environment === "preview"
            ? ":" + (process.env.VERCEL_GIT_COMMIT_REF ?? "default")
            : "";
    // Deployments sharing one Supabase database must also share this namespace.
    const namespace = process.env.UPSTASH_CACHE_NAMESPACE ?? environment + branch;
    return "etb:public-rooms:v1:" + encodeURIComponent(namespace);
};

const configured = () =>
    Boolean(
        process.env.UPSTASH_REDIS_REST_URL &&
        process.env.UPSTASH_REDIS_REST_TOKEN,
    );

const warn = (error: unknown) => {
    if (Date.now() - lastWarningAt < 60_000) return;
    lastWarningAt = Date.now();
    serverError("Upstash public-room cache unavailable; using Supabase", error);
};

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

const generationKey = () => getPrefix() + ":generation";
const dataKey = (generation: string) =>
    getPrefix() + ":list:" + generation;

async function getGeneration(): Promise<string> {
    const value = await command<string | number>(["GET", generationKey()]);
    if (value === null) return "0";
    const generation = String(value);
    if (!/^\d+$/.test(generation)) throw new Error("Invalid cache generation");
    return generation;
}

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
        const generation = await getGeneration();
        const encoded = await command<string>(["GET", dataKey(generation)]);
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
