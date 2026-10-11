/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function evaluate(source, globals = {}) {
    const scope = { exports: {}, ...globals };
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
            },
        }).outputText,
        scope,
    );
    return scope.exports;
}
function load(file, globals = {}) {
    return evaluate(fs.readFileSync(path.join(root, file), "utf8"), globals);
}
const memory = load("lib/playground/memory.ts");
const scheduler = load("lib/playground/scheduler.ts", {
    require: () => memory,
});
const input = load("lib/playground/recall-input.ts");
const clock = load("lib/playground/bomb-clock.ts");
const now = new Date("2026-10-07T00:00:00Z");
const initial = (id = "a") => ({
    ...memory.createInitialMemory("u", "r", id),
    reviewCount: 1,
    lastReviewedAt: now.toISOString(),
});
const observation = (extra = {}) => ({
    success: true,
    answerLength: 8,
    firstAttemptCorrect: true,
    attemptCount: 1,
    incorrectInputCount: 0,
    hintCount: 0,
    revealedHintChars: 0,
    maxCorrectPrefixLength: 8,
    recallLatencyMs: 100,
    elapsedMs: 1200,
    finalCueRatio: 0,
    initialCueRatio: 0,
    additionalHintCount: 0,
    elapsedSincePresentationMs: 10000,
    ...extra,
});
const apply = (m, o) =>
    memory.applyRecallObservation({
        memory: m,
        observation: o,
        userId: "u",
        roomId: "r",
        itemId: m?.itemId ?? "a",
        now,
    });
function rng(seed) {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}
function simulate(
    size,
    {
        seed = 1,
        kind = () => "fast",
        graduated = false,
        turns = size * 4,
        bot = false,
    } = {},
) {
    const random = rng(seed),
        ids = Array.from({ length: size }, (_, i) => String(i));
    const state = scheduler.createScheduler(ids, random),
        memories = {},
        seen = new Set(),
        trace = [];
    if (graduated)
        for (const id of ids)
            memories[id] = {
                ...initial(id),
                stability: 100,
                learningState: { phase: "graduated", freeRecallSuccesses: 2 },
            };
    let coverage = null,
        lastCycle = 0;
    for (let i = 0; i < turns; i++) {
        const pending = { ...state.retries };
        const selected = scheduler.chooseNextUserItem(
            state,
            memories,
            random,
            now.getTime(),
        );
        assert(selected);
        if (selected.retry) {
            assert(
                selected.turn >= selected.retry.earliestTurn,
                "retry before earliest",
            );
            assert(
                selected.turn <= selected.retry.latestTurn,
                "retry missed deadline",
            );
        }
        for (const entry of Object.values(pending))
            if (entry.itemId !== selected.itemId)
                assert(
                    entry.latestTurn > selected.turn,
                    "another retry starved",
                );
        if (selected.advancesCycle) {
            assert(
                selected.turn - lastCycle <= scheduler.CYCLE_STRIDE,
                "cycle starved",
            );
            lastCycle = selected.turn;
        }
        if (selected.cycle === 1) seen.add(selected.itemId);
        const action = kind(selected.itemId, selected.turn, selected);
        const o = observation(
            action === "fail"
                ? { success: false, firstAttemptCorrect: false }
                : action === "hint"
                  ? {
                        finalCueRatio: 1,
                        revealedHintChars: 8,
                        answerWasFullyRevealed: true,
                        additionalHintCount: 4,
                    }
                  : action === "typo"
                    ? { incorrectInputCount: 1, firstAttemptCorrect: false }
                    : {},
        );
        const evaluation = memory.evaluateRecall(o);
        scheduler.recordUserAnswer(state, evaluation);
        memories[selected.itemId] = apply(
            memories[selected.itemId] ?? initial(selected.itemId),
            o,
        );
        for (const entry of Object.values(state.retries))
            assert(
                entry.latestTurn - state.turn <= scheduler.retryWaitBound(size),
                "unbounded retry reservation",
            );
        trace.push({ ...selected, evaluation });
        if (coverage === null && seen.size === size) coverage = selected.turn;
        if (bot) {
            const before = JSON.stringify({
                turn: state.turn,
                queue: state.cycleQueue,
                retries: state.retries,
                answered: state.userAnswered,
            });
            const id = scheduler.chooseBotItem(state, random);
            if (id !== null) {
                const protectedForUpcomingRecall =
                    Boolean(state.retries[id]) ||
                    state.cycleQueue
                        .slice(0, scheduler.BOT_LOOKAHEAD)
                        .includes(id);
                // A protected BOT item is allowed only as the tiny-room
                // fallback, where the user has already answered it.
                assert(
                    !protectedForUpcomingRecall ||
                        (state.userAnswered[id] ?? 0) > 0,
                );
                scheduler.recordBotPresentation(state, id);
                memories[id] = memory.recordAnswerExposure(memories[id], now);
            }
            assert.equal(
                JSON.stringify({
                    turn: state.turn,
                    queue: state.cycleQueue,
                    retries: state.retries,
                    answered: state.userAnswered,
                }),
                before,
            );
        }
    }
    return { state, memories, trace, coverage };
}
for (const size of [20, 100])
    test(`${size} fast correct words cover exactly once in ${size} user answers`, () => {
        for (let seed = 1; seed <= 20; seed++) {
            const result = simulate(size, { seed, turns: size, bot: true });
            assert.equal(result.coverage, size);
            assert.equal(new Set(result.trace.map((x) => x.itemId)).size, size);
            assert.equal(Object.keys(result.state.retries).length, 0);
        }
        console.log(
            `Coverage: ${size} words / ${size} user answers (20 shuffle seeds)`,
        );
    });
test("graduated/high stability rows participate in every complete shuffle cycle", () => {
    const { trace, coverage } = simulate(20, { graduated: true, turns: 100 });
    assert.equal(coverage, 20);
    for (let cycle = 1; cycle <= 5; cycle++)
        assert.equal(
            new Set(trace.filter((x) => x.cycle === cycle).map((x) => x.itemId))
                .size,
            20,
        );
});
test("one failed word returns inside each promised window without delaying coverage", () => {
    const result = simulate(20, {
        kind: (id) => (id === "0" ? "fail" : "fast"),
        turns: 80,
    });
    assert(result.coverage <= 40);
    assert(
        result.trace.filter((x) => x.itemId === "0" && x.reason === "retry")
            .length > 2,
    );
    const easy = result.trace.filter((x) => x.cycle === 1 && x.itemId !== "0");
    assert.equal(easy.length, 19);
});
test("concurrent failures never starve retries or cycles, including tiny sets", () => {
    for (const size of [1, 2, 3, 4, 8, 20, 100])
        for (let seed = 1; seed <= 8; seed++) {
            const result = simulate(size, {
                seed,
                kind: () => "fail",
                turns: size * 8 + 20,
            });
            assert(result.coverage <= size * scheduler.CYCLE_STRIDE);
            assert(result.state.completedCycles >= 1);
        }
});
test("mixed errors, full hints and fast answers preserve both bounds over long sessions", () => {
    for (let seed = 1; seed <= 30; seed++) {
        const random = rng(seed * 41);
        const result = simulate(30, {
            seed,
            turns: 500,
            bot: true,
            kind: () => {
                const v = random();
                return v < 0.3
                    ? "fail"
                    : v < 0.6
                      ? "hint"
                      : v < 0.75
                        ? "typo"
                        : "fast";
            },
        });
        assert(result.coverage <= 60);
    }
});
test("retry success widens the gap, second success clears it, renewed failure resets short gap", () => {
    const state = scheduler.createScheduler(
        Array.from({ length: 20 }, (_, i) => String(i)),
        rng(2),
    );
    let selected = scheduler.chooseNextUserItem(state),
        target = selected.itemId;
    scheduler.recordUserAnswer(
        state,
        memory.evaluateRecall(observation({ success: false })),
    );
    assert.equal(
        state.retries[target].earliestTurn,
        state.turn + scheduler.SHORT_RETRY_GAP,
    );
    while (true) {
        selected = scheduler.chooseNextUserItem(state);
        scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
        if (selected.itemId === target) break;
    }
    assert.equal(state.retries[target].successCount, 1);
    assert.equal(
        state.retries[target].earliestTurn,
        state.turn + scheduler.CONFIRM_RETRY_GAP,
    );
    while (true) {
        selected = scheduler.chooseNextUserItem(state);
        scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
        if (selected.itemId === target) break;
    }
    assert.equal(state.retries[target], undefined);
});
test("light corrected typo is distinct from a fully revealed answer", () => {
    const current = { ...initial(), stability: 5 };
    const typo = observation({
        incorrectInputCount: 1,
        firstAttemptCorrect: false,
    });
    const full = observation({
        finalCueRatio: 1,
        answerWasFullyRevealed: true,
        revealedHintChars: 8,
    });
    assert.equal(memory.evaluateRecall(typo).memoryEvidence, "recall");
    assert.equal(memory.evaluateRecall(typo).retryNeed, "none");
    assert.equal(
        memory.evaluateRecall(full).memoryEvidence,
        "insufficient_evidence",
    );
    assert.equal(memory.evaluateRecall(full).retryNeed, "short");
    assert(apply(current, typo).stability >= current.stability);
    assert(apply(current, full).stability < current.stability);
});
test("recent BOT exposure supplies no independent recall or long-term gain", () => {
    const current = { ...initial(), stability: 5 };
    const exposed = memory.recordAnswerExposure(current, now);
    assert.equal(exposed.reviewCount, current.reviewCount);
    assert.equal(exposed.lastReviewedAt, current.lastReviewedAt);
    assert.equal(exposed.stability, current.stability);
    const o = observation({ elapsedSincePresentationMs: 500 });
    assert.equal(memory.evaluateRecall(o).independent, false);
    assert.equal(
        memory.evaluateRecall(o).memoryEvidence,
        "insufficient_evidence",
    );
    assert.equal(apply(exposed, o).stability, exposed.stability);
});
test("all words start without forced cues; speed does not multiply stability gain", () => {
    assert.equal(memory.createTurnPlan(undefined).initialCueRatio, 0);
    assert.equal(
        memory.createTurnPlan({
            ...initial(),
            learningState: { phase: "supported_recall" },
        }).initialCueRatio,
        0,
    );
    const current = { ...initial(), lastReviewedAt: "2026-10-06T00:00:00Z" };
    const fast = observation(),
        normal = observation({ elapsedMs: 4500, recallLatencyMs: 3000 });
    assert.equal(
        apply(current, fast).stability,
        apply(current, normal).stability,
    );
});
test("bomb and hint helpers retain their independent behavior", () => {
    assert.equal(clock.advanceBombClock(0.5, 5000, 10000, false), 1);
    assert.equal(clock.advanceBombClock(0.5, 5000, 10000, true), 0.5);
    assert.equal(input.hintCoversError(["Y"], "Hello", 1), true);
    assert.equal(input.hintCoversError(["H"], "Hello", 1), false);
});

test("BOT fallback stays null only before the user has answered anything", () => {
    const state = scheduler.createScheduler(["a", "b", "c"], () => 0);
    assert.equal(
        scheduler.chooseBotItem(state, () => 0.5),
        null,
    );
});

test("BOT fallback keeps the handoff alive after a user answer when every word is protected", () => {
    const state = scheduler.createScheduler(["a", "b", "c"], () => 0);
    const selected = scheduler.chooseNextUserItem(state, {}, () => 0);
    scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));

    // In a three-word room BOT_LOOKAHEAD protects the remaining cycle,
    // while the answered word may also be unavailable to the strict pool.
    // The fallback must still return an already answered word.
    state.retries[selected.itemId] = {
        itemId: selected.itemId,
        earliestTurn: state.turn + 1,
        latestTurn: state.turn + 4,
        reason: "uncertain_recall",
        successCount: 0,
    };

    for (let i = 0; i < 20; i++) {
        const id = scheduler.chooseBotItem(state, rng(i + 1));
        assert.notEqual(id, null);
        assert((state.userAnswered[id] ?? 0) > 0);
    }
});

test("BOT random fallback prefers non-protected words before protected answered words", () => {
    const state = scheduler.createScheduler(["a", "b", "c", "d", "e"], () => 0);
    state.userAnswered.a = 1;
    state.lastBotItem = "a";
    state.cycleQueue = ["b", "c", "d"];
    state.retries.a = {
        itemId: "a",
        earliestTurn: 2,
        latestTurn: 4,
        reason: "uncertain_recall",
        successCount: 0,
    };

    // b/c/d are lookahead-protected and a is retry-protected, leaving e as
    // the safe random fallback.
    assert.equal(
        scheduler.chooseBotItem(state, () => 0.75),
        "e",
    );
});

// Exercise the real queue callback, including arrivals during an in-flight request.
function getCallback(name, globals) {
    const source = fs.readFileSync(
        path.join(root, "app/(game)/playground/Client.tsx"),
        "utf8",
    );
    const ast = ts.createSourceFile(
        "Client.tsx",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    let callback;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
            callback = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert(callback);
    const printed = ts
        .createPrinter()
        .printNode(ts.EmitHint.Expression, callback, ast);
    return evaluate("export const callback = " + printed, globals).callback;
}

test("memory sync serializes newer writes and retains unsent data on rejection", async () => {
    const pending = { current: new Map([["a", initial()]]) };
    const inFlight = { current: null };
    let release,
        calls = 0,
        savingError = false;
    const snapshots = [];
    const flush = getCallback("flushPendingMemory", {
        cachePendingMemory: () => {},
        pendingMemoryRef: pending,
        syncInFlightRef: inFlight,
        setSaveError: (value) => {
            savingError = value;
        },
        room: { id: "r" },
        posthog: { capture: () => {} },
        console: { error: () => {} },
        syncPlaygroundMemory: (snapshot) => {
            snapshots.push(snapshot);
            calls++;
            if (calls === 1)
                return new Promise((resolve) => {
                    release = resolve;
                });
            return Promise.resolve(null);
        },
    });
    const first = flush();
    const newer = { ...initial(), reviewCount: 2 };
    pending.current.set("a", newer);
    const second = flush();
    assert.equal(calls, 1);
    release(null);
    await Promise.all([first, second]);
    assert.equal(calls, 2);
    assert.equal(snapshots[1][0], newer);
    assert.equal(pending.current.size, 0);
    assert.equal(inFlight.current, null);
    const failing = getCallback("flushPendingMemory", {
        cachePendingMemory: () => {},
        pendingMemoryRef: pending,
        syncInFlightRef: inFlight,
        setSaveError: (value) => {
            savingError = value;
        },
        room: { id: "r" },
        posthog: { capture: () => {} },
        console: { error: () => {} },
        syncPlaygroundMemory: () => Promise.reject(new Error("offline")),
    });
    pending.current.set("a", newer);
    await failing();
    assert.equal(pending.current.get("a"), newer);
    assert.equal(savingError, true);
    assert.equal(inFlight.current, null);
});

function clientCallbacks(names, globals) {
    const source = fs.readFileSync(
        path.join(root, "app/(game)/playground/Client.tsx"),
        "utf8",
    );
    const ast = ts.createSourceFile(
        "Client.tsx",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    const found = {};
    function visit(node) {
        if (
            ts.isVariableDeclaration(node) &&
            names.includes(node.name.getText(ast))
        )
            found[node.name.getText(ast)] = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
    }
    visit(ast);
    return evaluate(
        names
            .map(
                (name) =>
                    "export const " +
                    name +
                    " = " +
                    ts
                        .createPrinter()
                        .printNode(ts.EmitHint.Expression, found[name], ast) +
                    ";",
            )
            .join("\n"),
        globals,
    );
}
test("actual Client callbacks cover 20/100 words and preserve scheduler telemetry with BOT turns", () => {
    for (const size of [20, 100]) {
        let time = now.getTime();
        class Clock extends Date {
            constructor(...args) {
                super(...(args.length ? args : [time]));
            }
            static now() {
                return time;
            }
        }
        const m = load("lib/playground/memory.ts", { Date: Clock });
        const sch = load("lib/playground/scheduler.ts", {
            Date: Clock,
            require: () => m,
        });
        const ref = (current) => ({ current }),
            noop = () => {};
        const items = Array.from({ length: size }, (_, i) => ({
            id: String(i),
            type: "typed_recall",
            answer: "abcdefgh",
        }));
        const events = [];
        const globals = {
            ...m,
            ...sch,
            Date: Clock,
            items,
            room: { id: "r" },
            LOCAL_USER_ID: "local",
            initialSounDeffects: false,
            schedulerRef: ref(
                sch.createScheduler(
                    items.map((x) => x.id),
                    rng(17),
                ),
            ),
            usersRef: ref([{ id: "local" }, { id: "bot" }]),
            currentTurnRef: ref(0),
            currentItemRef: ref(null),
            recallProgressRef: ref(null),
            sessionTurnNumberRef: ref(0),
            memoryByItemRef: ref({}),
            exposureGapAtStartRef: ref(null),
            expectedTypingAtStartRef: ref(0),
            userTypingDelayRef: ref(220),
            authenticatedUserIdRef: ref("u"),
            pendingMemoryRef: ref(new Map()),
            userReviewCountRef: ref(0),
            previousInputAtRef: ref(null),
            previousInputLengthRef: ref(0),
            successAudioRef: ref(null),
            posthog: {
                capture: (event, payload) => events.push({ event, ...payload }),
            },
        };
        for (const setter of [
            "setCurrentItem",
            "setRecallPressurePaused",
            "setItemPresentationKey",
            "setCurrentTurn",
            "setMemoryByItem",
            "setCurrentInput",
        ])
            globals[setter] = noop;
        const actual = clientCallbacks(
            [
                "saveBotExposure",
                "setTrackedItem",
                "chooseItemForTurn",
                "resolveTurnWithItem",
                "setTrackedTurn",
                "updateLocalMemory",
                "handleRecallComplete",
                "handleSuccess",
            ],
            globals,
        );
        const first = actual.resolveTurnWithItem(0);
        actual.setTrackedTurn(first.turnIndex);
        actual.setTrackedItem(first.item);
        const seen = new Set();
        for (let turn = 0; turn < size; turn++) {
            assert.equal(globals.currentTurnRef.current, 0);
            const id = globals.currentItemRef.current.id;
            assert(!seen.has(id));
            seen.add(id);
            time += 1200;
            actual.handleRecallComplete(observation());
            actual.handleSuccess();
            if (globals.currentTurnRef.current === 1) {
                const before = globals.userReviewCountRef.current;
                time += 1000;
                actual.handleSuccess();
                assert.equal(globals.userReviewCountRef.current, before);
            }
        }
        assert.equal(seen.size, size);
        const recallEvents = events.filter(
            (x) => x.event === "playground_item_recalled",
        );
        assert.equal(recallEvents.length, size);
        assert(
            recallEvents.every(
                (x) =>
                    x.scheduler_reason === "cycle" &&
                    x.memory_evidence === "strong_recall" &&
                    x.retry_need === "none",
            ),
        );
        assert(
            recallEvents.every(
                (x) => x.model_version === m.MEMORY_MODEL_VERSION,
            ),
        );
        assert.equal(
            Object.keys(globals.schedulerRef.current.retries).length,
            0,
        );
    }
});
test("actual input callbacks retain a wrong character through Backspace correction", () => {
    const source = fs.readFileSync(
        path.join(root, "components/feature/InputView.tsx"),
        "utf8",
    );
    const ast = ts.createSourceFile(
            "InputView.tsx",
            source,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TSX,
        ),
        names = ["triggerFailAnimation", "resetInput", "moveToNext"],
        found = {};
    function visit(node) {
        if (
            ts.isVariableDeclaration(node) &&
            names.includes(node.name.getText(ast))
        )
            found[node.name.getText(ast)] = node.initializer;
        if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onKeyDown")
            found.key = node.initializer.expression;
        ts.forEachChild(node, visit);
    }
    visit(ast);
    const print = (node) =>
        ts.createPrinter().printNode(ts.EmitHint.Expression, node, ast);
    const code =
        'let input=Array(5).fill(""),currentSelection=0; const setInput=v=>{input=v}; const setCurrentSelection=v=>{currentSelection=v};\n' +
        names
            .map((name) => "const " + name + " = " + print(found[name]) + ";")
            .join("\n") +
        "\nexport const key = " +
        print(found.key) +
        "; export const type = char => { const next=[...input]; next[currentSelection]=char; setInput(next); moveToNext(next); };";
    const ref = (current) => ({ current }),
        noop = () => {},
        observations = [];
    const actual = evaluate(code, {
        english: "apple",
        completedRef: ref(false),
        answerRevealed: false,
        manualHints: true,
        assistedPositions: [],
        hintEventsRef: ref([]),
        hintLength: 0,
        hintCount: 0,
        initialCueRatio: 0,
        initialCueLength: 0,
        timedHintCount: 0,
        learningMode: "free_recall",
        bombStatus: 0,
        attemptCountRef: ref(1),
        incorrectInputCountRef: ref(0),
        maxCorrectPrefixRef: ref(0),
        lastCorrectProgressAtRef: ref(0),
        firstKeyAtRef: ref(100),
        recallStartedAtRef: ref(0),
        inputFrameRef: ref(null),
        correctPrefixLength: input.correctPrefixLength,
        performance: { now: () => 1200 },
        onRecallComplete: (o) => observations.push(o),
        onSuccess: noop,
        onChangeInput: noop,
        setCharInput: noop,
        setIsFailAnimating: noop,
        setTimedHintCount: noop,
        setRevealedHintLength: noop,
        isSoundEffectsEnabled: () => false,
        console: { log: noop },
    });
    for (const char of "apx") actual.type(char);
    actual.key({ key: "Backspace", preventDefault: noop });
    for (const char of "ple") actual.type(char);
    assert.equal(observations.length, 1);
    assert.equal(observations[0].success, true);
    assert.equal(observations[0].firstAttemptCorrect, false);
    assert.equal(observations[0].incorrectInputCount, 1);
    assert.equal(memory.evaluateRecall(observations[0]).retryNeed, "none");
});
test("a renewed failure resets confirmation; exposure-assisted success never clears retry", () => {
    const state = scheduler.createScheduler(
        Array.from({ length: 10 }, (_, i) => String(i)),
        rng(9),
    );
    const first = scheduler.chooseNextUserItem(state);
    scheduler.recordUserAnswer(
        state,
        memory.evaluateRecall(observation({ success: false })),
    );
    function reachTarget(evaluation) {
        for (let count = 0; count < 100; count++) {
            const selected = scheduler.chooseNextUserItem(state);
            const target = selected.itemId === first.itemId;
            scheduler.recordUserAnswer(
                state,
                target ? evaluation : memory.evaluateRecall(observation()),
            );
            if (target) return;
        }
        assert.fail("retry target never returned");
    }
    reachTarget(memory.evaluateRecall(observation()));
    assert.equal(state.retries[first.itemId].successCount, 1);
    reachTarget(
        memory.evaluateRecall(observation({ elapsedSincePresentationMs: 0 })),
    );
    assert.equal(state.retries[first.itemId].successCount, 0);
    reachTarget(memory.evaluateRecall(observation({ success: false })));
    assert.equal(
        state.retries[first.itemId].earliestTurn,
        state.turn + scheduler.SHORT_RETRY_GAP,
    );
    assert.equal(state.retries[first.itemId].reason, "failed_recall");
});

test("manual hints skip solved letters and spaces and never reveal the last unresolved letter", () => {
    assert.equal(input.nextHintPosition([], "a", []), null);
    assert.equal(input.nextHintPosition([], "cat", []), 0);
    assert.equal(input.nextHintPosition([], "cat", [0, 1]), null);
    assert.equal(
        input.nextHintPosition(
            ["r", "e", "c", "i", "e", "v", "e"],
            "receive",
            [],
        ),
        3,
    );
    assert.equal(
        input.nextHintPosition(
            ["a", "b", "c", "d", "e", "f", "g"],
            "abcdefghij",
            [],
        ),
        7,
    );
    assert.equal(
        input.nextHintPosition(
            ["a", "b", "c", "d", "e", "f", "g"],
            "abcdefghij",
            [7],
        ),
        8,
    );
    assert.equal(input.nextHintPosition([], "a b", [0]), null);
    assert.equal(memory.createTurnPlan(undefined).hintDelaysMs, null);
});

function getInputFunction(name, globals) {
    const source = fs.readFileSync(
        path.join(root, "components/feature/InputView.tsx"),
        "utf8",
    );
    const ast = ts.createSourceFile(
        "Input.tsx",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    let found;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
            found = node.initializer;
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert(found);
    return evaluate(
        "export const callback = " +
            ts.createPrinter().printNode(ts.EmitHint.Expression, found, ast),
        globals,
    ).callback;
}

test("manual hint shortcut is handled by the text input change path", () => {
    const source = fs.readFileSync(
        path.join(root, "components/feature/InputView.tsx"),
        "utf8",
    );
    assert.match(source, /if \(char === " "\)/);
    assert.match(source, /if \(lastKeyWasSpaceRef\.current\)/);
    assert.match(source, /requestHint\(\)/);
});

test("full manual hint reuses the inline overlay and keeps typing enabled", () => {
    const source = fs.readFileSync(
        path.join(root, "components/feature/InputView.tsx"),
        "utf8",
    );
    assert.match(
        source,
        /opacity-25 border-b border-\(--color-border\) flex items-center justify-center/,
    );
    assert.doesNotMatch(source, /確認して次へ/);
    assert.doesNotMatch(source, /text-blue-600/);
    assert.match(source, /\{!isReadonly && \(/);
    assert.doesNotMatch(
        source,
        /if \(completedRef\.current \|\| answerRevealed\) return;/,
    );
});

test("full hint clears existing incorrect input and resets on later wrong typing", () => {
    const source = fs.readFileSync(
        path.join(root, "components/feature/InputView.tsx"),
        "utf8",
    );
    assert.match(
        source,
        /const hasIncorrectInput = input\.some\(/,
    );
    assert.match(
        source,
        /if \(hasIncorrectInput\) \{\s*resetInput\(\);\s*\}/,
    );
    assert.match(
        source,
        /typedInsideHint &&\s*\(!manualHints \|\| answerRevealed\)/,
    );
});

test("actual manual hint callback reveals the full answer and records one answer event", () => {
    const typed = ["r", "e", "c", "i", "e", "v", "e"];
    const events = { current: [] };
    const lastKeyWasSpaceRef = { current: true };
    let answerRevealed = false;
    const callback = getInputFunction("requestHint", {
        manualHints: true,
        english: "receive",
        answerRevealed: false,
        completedRef: { current: false },
        input: typed,
        hintEventsRef: events,
        performance: { now: () => 7000 },
        recallStartedAtRef: { current: 0 },
        lastKeyWasSpaceRef,
        setAnswerRevealed: (value) => {
            answerRevealed = value;
        },
    });
    callback();
    assert.equal(typed.join(""), "recieve");
    assert.equal(answerRevealed, true);
    assert.equal(lastKeyWasSpaceRef.current, false);
    assert.equal(events.current.length, 1);
    assert.equal(events.current[0].kind, "answer");
    assert.equal(events.current[0].correctBefore, 5);
    assert.equal(events.current[0].source, "manual");
});



test("actual playground progress callback pauses pressure on first hint", () => {
    const saved = { current: null };
    let paused = false;
    const callback = getCallback("handleRecallProgress", {
        usersRef: { current: [{ id: "local" }] },
        currentTurnRef: { current: 0 },
        LOCAL_USER_ID: "local",
        recallProgressRef: saved,
        currentItemRef: { current: { type: "typed_recall", answer: "apple" } },
        setRecallPressurePaused: (value) => {
            paused = value;
        },
    });
    callback({ hintCount: 1, revealedHintChars: 1 });
    assert.equal(paused, true);
    assert.equal(saved.current.revealedHintChars, 1);
});

test("correcting an interior letter completes a retained learning answer", () => {
    const observations = [];
    let advanced = 0;
    const noop = () => {};
    const ref = (current) => ({ current });
    const callback = getInputFunction("moveToNext", {
        completedRef: ref(false),
        answerRevealed: false,
        english: "apple",
        currentSelection: 2,
        manualHints: true,
        hintLength: 1,
        hintCount: 1,
        assistedPositions: [2],
        hintEventsRef: ref([]),
        initialCueRatio: 0,
        initialCueLength: 0,
        timedHintCount: 0,
        learningMode: "free_recall",
        incorrectInputCountRef: ref(1),
        attemptCountRef: ref(2),
        maxCorrectPrefixRef: ref(2),
        lastCorrectProgressAtRef: ref(0),
        firstKeyAtRef: ref(100),
        recallStartedAtRef: ref(0),
        correctPrefixLength: input.correctPrefixLength,
        performance: { now: () => 8000 },
        onRecallComplete: (x) => observations.push(x),
        onSuccess: () => advanced++,
        onChangeInput: noop,
        setInput: noop,
        setCurrentSelection: noop,
        setTimedHintCount: noop,
        setRevealedHintLength: noop,
        bombStatus: 0,
        console: { log: noop },
        isSoundEffectsEnabled: () => false,
    });
    callback(Array.from("apple"));
    assert.equal(advanced, 1);
    assert.equal(observations[0].outcome, "cued_recall");
    assert.equal(observations[0].revealedHintChars, 1);
    assert.equal(observations[0].firstAttemptCorrect, false);
});
