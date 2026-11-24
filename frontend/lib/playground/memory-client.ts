import posthog from "posthog-js";
import { BETA_ACTION_DENIED } from "@/lib/auth/beta-action";
import { createClient } from "@/lib/db/client";
import { syncPlaygroundMemory } from "./memory-actions";
import { MemoryQueue } from "./memory-queue";

export { loadPlaygroundMemory } from "./memory-actions";

export function startMemorySync(userId: string, roomId: string, mode: "online" | "offline", enabled = true) {
    let unsubscribe: (() => void) | undefined;
    const queue = new MemoryQueue({
        userId,
        roomId,
        storage: () => localStorage,
        online: () => enabled && navigator.onLine,
        async send(rows) {
            try {
                return await syncPlaygroundMemory(roomId, userId, rows);
            } catch (error) {
                // The beta gate can refuse the request before the action runs.
                if (error instanceof Error && error.message === BETA_ACTION_DENIED)
                    return { type: "auth_required" };
                throw error;
            }
        },
        async runExclusive(name, task) {
            if (!navigator.locks) return task();
            let started = false;
            try {
                await navigator.locks.request(name, { ifAvailable: true }, async lock => {
                    if (!lock) return;
                    started = true;
                    await task();
                });
            } catch (error) {
                if (started) throw error;
                await task();
            }
        },
        onAuthRequired() {
            if (unsubscribe) return;
            try {
                let accessToken: string | undefined;
                const { data } = createClient().auth.onAuthStateChange((event, session) => {
                    const previous = accessToken;
                    accessToken = session?.access_token;
                    const usableSession = session?.user.id === userId &&
                        (session.expires_at ?? 0) * 1000 > Date.now();
                    if (usableSession && accessToken && accessToken !== previous &&
                        ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event)) {
                        // Do not call another auth operation inside the auth callback.
                        setTimeout(() => queue.resumeAuth(), 0);
                    }
                });
                unsubscribe = () => data.subscription.unsubscribe();
            } catch {
                // A later authenticated page load can resume the durable queue.
            }
        },
        report(metrics) {
            // Preserve the existing failure event. Sample successful batches and
            // let the browser SDK batch ingestion with its other events.
            if (!metrics.error_type && Math.random() >= 0.1) return;
            try {
                posthog.capture(metrics.error_type
                    ? "playground_memory_sync_failed" : "playground_memory_sync_succeeded",
                    { ...metrics, mode, sample_rate: metrics.error_type ? 1 : 0.1 });
            } catch {}
        },
    });

    const flush = () => { void queue.flush(); };
    const onVisibility = () => {
        if (document.visibilityState === "hidden") flush();
    };
    const onStorage = (event: StorageEvent) => {
        if (event.key?.startsWith(`playground-outbox:${userId}:${roomId}:`))
            queue.schedule();
    };
    window.addEventListener("online", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);

    return {
        queue,
        stop() {
            window.removeEventListener("online", flush);
            window.removeEventListener("pagehide", flush);
            window.removeEventListener("storage", onStorage);
            document.removeEventListener("visibilitychange", onVisibility);
            unsubscribe?.();
            queue.stop();
        },
    };
}
