import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRecallObservation, createInitialMemory, recordAnswerModeResult, type ItemMemoryState } from "../../lib/playground/memory";
import { MemoryQueue } from "../../lib/playground/memory-queue";
import { MEMORY_BATCH_SIZE, type MemorySyncResult } from "../../lib/playground/memory-sync-format";
import { memoryStorageId } from "../../lib/playground/memory-storage-id";

const userId = "00000000-0000-4000-8000-000000000002";
const roomId = "00000000-0000-4000-8000-000000000001";
const legacyKey = `playground-pending:${userId}:${roomId}`;
const saved = { type: "saved", rejected: [] } as const satisfies MemorySyncResult;

function storage() {
    const values = new Map<string, string>();
    const localStorage: Storage = {
        get length() { return values.size; },
        key: index => [...values.keys()][index] ?? null,
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: key => { values.delete(key); },
        clear: () => values.clear(),
    };
    return { localStorage, values };
}

function snapshot(itemId = "legacy-A", reviewCount = 1, updatedAt = Date.now()) {
    return {
        ...createInitialMemory(userId, roomId, itemId),
        reviewCount,
        updatedAt: new Date(updatedAt).toISOString(),
    };
}

function fixture(shared = storage()) {
    const batches: ItemMemoryState[][] = [];
    let result: MemorySyncResult = saved;
    let online = true;
    let authRequests = 0;
    let sendHook: (() => Promise<MemorySyncResult>) | undefined;
    const reports: Parameters<ConstructorParameters<typeof MemoryQueue>[0]["report"]>[0][] = [];
    const open = () => new MemoryQueue({
        userId, roomId,
        storage: () => shared.localStorage,
        online: () => online,
        send: async rows => {
            batches.push(rows);
            return sendHook ? sendHook() : result;
        },
        onAuthRequired: () => { authRequests++; },
        report: report => reports.push(report),
    });
    return {
        ...shared, open, batches, reports,
        setResult: (next: MemorySyncResult) => { result = next; },
        setOnline: (next: boolean) => { online = next; },
        setSend: (next: typeof sendHook) => { sendHook = next; },
        authRequests: () => authRequests,
    };
}

test("30 consecutive typing and selection answers use one scheduled batch; idle uses none", async t => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
    const f = fixture();
    const queue = f.open();
    t.mock.timers.tick(60_000);
    assert.equal(f.batches.length, 0);
    let typed: ItemMemoryState | undefined;
    let choice: ItemMemoryState | undefined;
    for (let i = 0; i < 30; i++) {
        if (i % 2 === 0) {
            typed = applyRecallObservation({
                memory: typed, userId, roomId, itemId: "typing",
                observation: { success: true, answerLength: 4, firstAttemptCorrect: true,
                    attemptCount: 1, hintCount: 0, revealedHintChars: 0,
                    maxCorrectPrefixLength: 4, recallLatencyMs: 500, elapsedMs: 800 },
            });
            queue.enqueue(typed);
        } else {
            choice = recordAnswerModeResult({
                memory: choice, userId, roomId, itemId: "choice", mode: "selection", success: true,
            });
            queue.enqueue(choice);
        }
        assert.equal(f.batches.length, 0);
        assert.ok(f.values.size > 0);
        t.mock.timers.tick(1_000);
    }
    await queue.flush();
    assert.equal(f.batches.length, 1);
    assert.equal(f.batches[0].length, 2);
    assert.equal(f.batches[0].find(row => row.itemId === "typing")?.reviewCount, 15);
    assert.equal(f.batches[0].find(row => row.itemId === "choice")?.answerModeStats?.recognition.attempts, 15);
    t.mock.timers.tick(60_000);
    assert.equal(f.batches.length, 1);
    queue.stop();
});

test("a rapid queue of over 500 words is bounded and survives an interrupted page close", async () => {
    const f = fixture();
    f.setOnline(false);
    const closing = f.open();
    for (let i = 0; i < 512; i++) closing.enqueue(snapshot(`item-${i}`));
    closing.stop();

    const reopened = f.open();
    const restored = {};
    reopened.restore(restored, new Set(["item-0", "item-511"]));
    assert.deepEqual(Object.keys(restored).sort(), ["item-0", "item-511"]);
    f.setOnline(true);
    await reopened.flush();
    assert.equal(f.batches.flat().length, 512);
    assert.ok(f.batches.every(batch => batch.length <= MEMORY_BATCH_SIZE));
    assert.equal(f.values.size, 0);
    reopened.stop();
});

test("an ACK cannot remove an update created in the same or a second tab during the request", async () => {
    const shared = storage();
    const f = fixture(shared);
    const other = fixture(shared);
    const first = f.open();
    const tab = other.open();
    const now = Date.now();
    first.enqueue(snapshot("a", 1, now));
    let settle!: (value: MemorySyncResult) => void;
    f.setSend(() => new Promise(resolve => { settle = resolve; }));
    const inFlight = first.flush();
    first.enqueue(snapshot("a", 2, now + 1));
    tab.enqueue(snapshot("b", 3, now + 2));
    settle(saved);
    await inFlight;
    f.setSend(undefined);

    const reloaded: Record<string, ItemMemoryState> = {};
    tab.restore(reloaded, new Set(["a", "b"]));
    assert.equal(reloaded.a.reviewCount, 2);
    assert.equal(reloaded.b.reviewCount, 3);
    await tab.flush();
    await first.flush();
    assert.deepEqual(other.batches[0].map(row => row.reviewCount).sort(), [2, 3]);
    assert.equal(f.batches.length, 1);
    assert.equal(f.values.size, 0);
    first.stop();
    tab.stop();
});

test("legacy nullable stats and dates are recovered; invalid rows are retained separately", async () => {
    const f = fixture();
    const good = { ...snapshot(), updatedAt: null, lastPresentedAt: new Date().toISOString(), answerModeStats: null };
    const invalid = { ...snapshot("broken"), difficulty: 30 };
    f.localStorage.setItem(legacyKey, JSON.stringify([good, invalid, snapshot("reject-on-server")]));
    const queue = f.open();
    const restored: Record<string, ItemMemoryState> = {};
    queue.restore(restored, new Set(["legacy-A", "broken"]));
    assert.equal(restored["legacy-A"].updatedAt, good.lastPresentedAt);
    assert.equal(restored["legacy-A"].answerModeStats, undefined);
    assert.equal(restored.broken, undefined);
    f.setResult({ type: "saved", rejected: [{ index: 1, reason: "timestamp" }] });
    await queue.flush();
    assert.deepEqual(f.batches[0].map(row => row.itemId), ["legacy-A", "reject-on-server"]);
    const held = [...f.values.values()].map(value => JSON.parse(value));
    assert.deepEqual(held.map(row => row.rejected), ["difficulty", "timestamp"]);
    assert.deepEqual(held[0].value, invalid);
    const reload = f.open();
    await reload.flush();
    assert.equal(f.batches.length, 1);
    assert.equal(f.reports[0].invalid_fields?.difficulty, 1);
    assert.equal(f.reports[1].invalid_fields?.timestamp, 1);
    queue.stop();
    reload.stop();
});

test("offline, lifecycle flushes, and reload respect temporary backoff; auth waits for recovery", async t => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
    const f = fixture();
    f.setOnline(false);
    const queue = f.open();
    queue.enqueue(snapshot());
    await queue.flush();
    assert.equal(f.batches.length, 0);

    f.setOnline(true);
    f.setSend(async () => { throw new Error("connection lost"); });
    await queue.flush();
    queue.enqueue(snapshot("newer"));
    queue.stop();
    const reload = f.open();
    await reload.flush();
    assert.equal(f.batches.length, 1);
    t.mock.timers.tick(2_000);
    await reload.flush();
    assert.equal(f.batches.length, 1);

    f.setSend(undefined);
    f.setResult({ type: "auth_required" });
    t.mock.timers.tick(3_001);
    await reload.flush();
    assert.equal(f.batches.length, 2);
    assert.equal(f.authRequests(), 1);
    reload.enqueue(snapshot("while-signed-out"));
    t.mock.timers.tick(60_000);
    await reload.flush();
    assert.equal(f.batches.length, 2);

    f.setResult(saved);
    reload.resumeAuth();
    await reload.flush();
    assert.equal(f.batches.length, 3);
    assert.equal(f.batches[2].length, 3);
    reload.stop();
});

test("permanent failures remain recoverable and are never sent on later flushes", async () => {
    const f = fixture();
    f.setResult({ type: "permanent", databaseCode: "23503" });
    const queue = f.open();
    queue.enqueue(snapshot());
    await queue.flush();
    f.setResult(saved);
    queue.enqueue(snapshot("another-word"));
    await queue.flush();
    assert.deepEqual(f.batches.map(batch => batch.map(row => row.itemId)), [["legacy-A"], ["another-word"]]);
    assert.equal([...f.values.values()].map(value => JSON.parse(value).rejected).join(), "23503");
    queue.stop();
});

test("storage IDs are stable and preserve the UUIDs already stored in Postgres", () => {
    const canonical = "00000000-0000-4000-8000-000000000001";
    assert.equal(memoryStorageId(roomId, canonical), canonical);
    const mapped = memoryStorageId(roomId, "old_id-1");
    assert.equal(memoryStorageId(roomId, "old_id-1"), mapped);
    assert.notEqual(memoryStorageId(userId, "old_id-1"), mapped);
    assert.notEqual(memoryStorageId(roomId, "old_id-2"), mapped);
});
