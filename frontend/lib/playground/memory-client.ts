import posthog from "posthog-js";
import { syncPlaygroundMemory as syncMemoryOnServer } from "@/lib/playground/memory-actions";
import type { ItemMemoryState } from "@/lib/playground/memory";

export { loadPlaygroundMemory } from "@/lib/playground/memory-actions";

export async function syncPlaygroundMemory(
    memory: ItemMemoryState[],
    roomId: string,
    mode: "offline" | "online",
) {
    const properties = { room_id: roomId, mode, batch_size: memory.length };
    let result: Awaited<ReturnType<typeof syncMemoryOnServer>>;
    try {
        result = await syncMemoryOnServer(memory);
    } catch (error) {
        posthog.capture("playground_memory_sync_failed", {
            ...properties,
            error_type:
                navigator.onLine === false ? "offline" : "request_failed",
        });
        throw error;
    }
    if (result) {
        posthog.capture("playground_memory_sync_failed", {
            ...properties,
            error_type: result.type,
            ...(result.databaseCode
                ? { database_error_code: result.databaseCode }
                : {}),
        });
    }
    return result;
}
