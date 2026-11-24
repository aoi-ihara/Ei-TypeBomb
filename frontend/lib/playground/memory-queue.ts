import type { ItemMemoryState } from "./memory";
import {
    MEMORY_BATCH_SIZE, MEMORY_SYNC_INTERVAL_MS, memoryTime, normalizeMemory,
    type MemorySyncResult,
} from "./memory-sync-format";

type Entry = { key: string; value: unknown; legacy?: boolean; rejected?: string };
type Report = {
    batch_size: number;
    pending_count: number;
    duration_ms: number;
    retry_count: number;
    server_duration_ms?: number;
    saved_count?: number;
    rejected_count?: number;
    error_type?: string;
    database_error_code?: string;
    invalid_fields?: Record<string, number>;
};

type Options = {
    userId: string;
    roomId: string;
    storage: () => Storage;
    online: () => boolean;
    send: (rows: ItemMemoryState[]) => Promise<MemorySyncResult>;
    runExclusive?: (name: string, task: () => Promise<void>) => Promise<void>;
    onAuthRequired: () => void;
    report: (report: Report) => void;
};

export class MemoryQueue {
    private readonly scope: string;
    private readonly prefix: string;
    private readonly retryKey: string;
    private readonly volatile = new Map<string, Entry>();
    private readonly ownKeys = new Map<string, string>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private inFlight: Promise<void> | undefined;
    private retryCount = 0;
    private retryAt = 0;
    private waitingForAuth = false;
    private flushAgain = false;
    private active = true;

    constructor(private readonly options: Options) {
        this.scope = `${options.userId}:${options.roomId}`;
        this.prefix = `playground-outbox:${this.scope}:`;
        this.retryKey = `playground-retry:${this.scope}`;
        this.importLegacy();
        this.retryCount = this.sharedRetry().count;
        this.schedule();
    }

    private persist(value: unknown, legacy = false) {
        const key = this.prefix + crypto.randomUUID();
        const entry: Entry = { key, value, legacy };
        try {
            this.options.storage().setItem(key, JSON.stringify(entry));
        } catch {
            this.volatile.set(key, entry);
        }
        return key;
    }

    private importLegacy() {
        const key = `playground-pending:${this.scope}`;
        try {
            const storage = this.options.storage();
            const original = storage.getItem(key);
            if (!original) return;
            const values: unknown = JSON.parse(original);
            if (!Array.isArray(values)) return;
            const keys = values.map(value => this.persist(value, true));
            if (!keys.some(entry => this.volatile.has(entry)) && storage.getItem(key) === original)
                storage.removeItem(key);
        } catch {
            // Retain unreadable legacy storage for recovery.
        }
    }

    private entries() {
        const entries = [...this.volatile.values()].filter(entry => !entry.rejected);
        try {
            const storage = this.options.storage();
            for (let index = 0; index < storage.length; index++) {
                const key = storage.key(index);
                if (!key?.startsWith(this.prefix)) continue;
                try {
                    const entry = JSON.parse(storage.getItem(key) ?? "null") as Entry | null;
                    if (entry?.key === key && !entry.rejected && !this.volatile.has(key)) entries.push(entry);
                } catch {
                    // Leave unreadable entries intact and continue scanning.
                }
            }
        } catch {}
        return entries;
    }

    private parse(entry: Entry) {
        return normalizeMemory(entry.value, this.options.userId, this.options.roomId, entry.legacy);
    }

    restore(memory: Record<string, ItemMemoryState>, itemIds: Set<string>) {
        for (const entry of this.entries()) {
            const parsed = this.parse(entry);
            if ("reason" in parsed || !itemIds.has(parsed.memory.itemId)) continue;
            const pending = parsed.memory;
            const remote = memory[pending.itemId];
            if (!remote || memoryTime(pending.updatedAt) > memoryTime(remote.updatedAt) ||
                !Number.isFinite(memoryTime(remote.updatedAt))) {
                memory[pending.itemId] = pending;
            }
        }
    }

    enqueue(value: ItemMemoryState) {
        const key = this.persist(value);
        const previous = this.ownKeys.get(value.itemId);
        const parsed = normalizeMemory(value, this.options.userId, this.options.roomId);
        if ("memory" in parsed) {
            if (previous && !this.volatile.has(key)) {
                try {
                    const saved = this.options.storage().getItem(previous);
                    if (saved && !JSON.parse(saved).rejected && !this.volatile.has(previous)) this.remove(previous);
                    if (!this.volatile.get(previous)?.rejected) this.volatile.delete(previous);
                } catch {}
            }
            this.ownKeys.set(value.itemId, key);
        }
        this.schedule();
    }

    private remove(key: string) {
        this.volatile.delete(key);
        try {
            this.options.storage().removeItem(key);
        } catch {}
    }

    private reject(entry: Entry, reason: string) {
        const rejected = { ...entry, rejected: reason };
        if (this.volatile.has(entry.key)) {
            this.volatile.set(entry.key, rejected);
            return;
        }
        try {
            const storage = this.options.storage();
            if (storage.getItem(entry.key) !== null)
                storage.setItem(entry.key, JSON.stringify(rejected));
        } catch {
            // Hide in this runtime even when quota prevents rewriting the entry.
            this.volatile.set(entry.key, rejected);
        }
    }

    private sharedRetry() {
        try {
            const stored = JSON.parse(this.options.storage().getItem(this.retryKey) ?? "null");
            if (Number.isFinite(stored?.at) && Number.isSafeInteger(stored.count) && stored.count >= 0)
                return { at: stored.at as number, count: stored.count as number };
        } catch {}
        return { at: 0, count: 0 };
    }

    private backoff() {
        this.retryCount = Math.max(this.retryCount, this.sharedRetry().count) + 1;
        const limit = Math.min(300_000, 5_000 * 2 ** Math.min(this.retryCount - 1, 6));
        this.retryAt = Date.now() + limit * (0.5 + 0.5 * Math.random());
        try {
            const storage = this.options.storage();
            if (this.retryAt > this.sharedRetry().at) {
                storage.setItem(this.retryKey, JSON.stringify({
                    at: this.retryAt, count: this.retryCount,
                }));
            }
        } catch {}
    }

    schedule() {
        if (!this.active || this.timer || this.inFlight || this.waitingForAuth || !this.options.online()) return;
        if (this.entries().length === 0) return;
        const retryAt = Math.max(this.retryAt, this.sharedRetry().at);
        const delay = retryAt > Date.now() ? retryAt - Date.now() : MEMORY_SYNC_INTERVAL_MS;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush();
        }, delay);
    }

    resumeAuth() {
        if (!this.active || !this.waitingForAuth) return;
        this.waitingForAuth = false;
        void this.flush();
    }

    flush(): Promise<void> {
        if (this.inFlight) {
            this.flushAgain = true;
            return this.inFlight;
        }
        if (!this.options.online() || this.waitingForAuth ||
            Date.now() < Math.max(this.retryAt, this.sharedRetry().at)) {
            this.schedule();
            return Promise.resolve();
        }
        clearTimeout(this.timer);
        this.timer = undefined;
        const drain = async () => {
            const retry = this.sharedRetry();
            this.retryCount = Math.max(this.retryCount, retry.count);
            if (Date.now() >= retry.at) await this.drain();
        };
        const run = this.options.runExclusive
            ? this.options.runExclusive(this.prefix, drain)
            : drain();
        this.inFlight = run.finally(() => {
            this.inFlight = undefined;
            if (this.flushAgain) {
                this.flushAgain = false;
                return this.flush();
            }
            this.schedule();
        });
        return this.inFlight;
    }

    stop() {
        this.active = false;
        clearTimeout(this.timer);
        this.timer = undefined;
        void this.flush();
    }

    private async drain() {
        const groups = new Map<string, { entry: Entry; memory: ItemMemoryState }[]>();
        const invalidFields: Record<string, number> = {};
        const entries = this.entries();
        for (const entry of entries) {
            const parsed = this.parse(entry);
            if ("reason" in parsed) {
                this.reject(entry, parsed.reason);
                invalidFields[parsed.reason] = (invalidFields[parsed.reason] ?? 0) + 1;
                continue;
            }
            const group = groups.get(parsed.memory.itemId) ?? [];
            group.push({ entry, memory: parsed.memory });
            groups.set(parsed.memory.itemId, group);
        }
        for (const group of groups.values())
            group.sort((a, b) => memoryTime(b.memory.updatedAt) - memoryTime(a.memory.updatedAt));

        if (Object.keys(invalidFields).length)
            this.options.report({ batch_size: 0, pending_count: entries.length, duration_ms: 0,
                retry_count: this.retryCount, error_type: "invalid_memory", invalid_fields: invalidFields });

        while (groups.size && this.options.online()) {
            const batch = [...groups.values()].slice(0, MEMORY_BATCH_SIZE).map(group => group[0]);
            const startedAt = performance.now();
            let result: MemorySyncResult;
            try {
                result = await this.options.send(batch.map(({ memory }) => memory));
            } catch {
                result = { type: "temporary" };
            }

            const metrics: Report = {
                batch_size: batch.length,
                pending_count: groups.size,
                duration_ms: Math.round(performance.now() - startedAt),
                retry_count: this.retryCount,
                server_duration_ms: result.serverDurationMs,
            };
            if (result.type === "saved") {
                const rejections = new Map(result.rejected.map(({ index, reason }) => [index, reason]));
                const invalid: Record<string, number> = {};
                for (const [index, { entry, memory }] of batch.entries()) {
                    const group = groups.get(memory.itemId)!;
                    const reason = rejections.get(index);
                    if (reason) {
                        this.reject(entry, reason);
                        invalid[reason] = (invalid[reason] ?? 0) + 1;
                        group.shift();
                        if (group.length === 0) groups.delete(memory.itemId);
                    } else {
                        group.forEach(({ entry }) => this.remove(entry.key));
                        groups.delete(memory.itemId);
                    }
                }
                metrics.saved_count = batch.length - rejections.size;
                metrics.rejected_count = rejections.size;
                this.options.report(rejections.size
                    ? { ...metrics, error_type: "invalid_memory", invalid_fields: invalid }
                    : metrics);
                this.retryCount = 0;
                this.retryAt = 0;
                try {
                    if (this.sharedRetry().at <= Date.now())
                        this.options.storage().removeItem(this.retryKey);
                } catch {}
                continue;
            }

            this.options.report({ ...metrics, error_type: result.type,
                database_error_code: result.databaseCode });
            if (result.type === "permanent") {
                for (const { memory } of batch) {
                    for (const candidate of groups.get(memory.itemId)!)
                        this.reject(candidate.entry, result.databaseCode ?? "permanent");
                    groups.delete(memory.itemId);
                }
                continue;
            }
            if (result.type === "auth_required") {
                this.waitingForAuth = true;
                if (this.active) this.options.onAuthRequired();
            } else {
                this.backoff();
            }
            return;
        }
    }
}
