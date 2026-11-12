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
const load = (file, globals) =>
    evaluate(fs.readFileSync(path.join(root, file), "utf8"), globals);
const hints = load("lib/playground/automatic-hint-evidence.ts");
const input = load("lib/playground/recall-input.ts");
const romaji = load("lib/romaji-input.mjs");
const memory = load("lib/playground/memory.ts");
const scheduler = load("lib/playground/scheduler.ts", {
    require: () => memory,
});
const online = load("lib/online/memory-session.ts", {
    require: (id) => (id.includes("scheduler") ? scheduler : memory),
});
const diagnostics = load("lib/online/recall-diagnostics.ts", {
    require: () => online,
});

// Execute the real input, timer and progress callbacks, as in playground.test.cjs.
const ast = ts.createSourceFile(
    "TypingView.tsx",
    fs.readFileSync(
        path.join(root, "components/recall/TypingView.tsx"),
        "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
);
function callback(name, globals) {
    let found;
    function visit(node) {
        if (
            ts.isVariableDeclaration(node) &&
            node.name.getText(ast) === name &&
            name !== "timer"
        )
            found = node.initializer;
        if (
            ts.isCallExpression(node) &&
            node.expression.getText(ast) === "useEffect"
        ) {
            const body = node.arguments[0].getText(ast);
            if (
                (name === "timer" && body.includes("const activeHintDelays")) ||
                (name === "progress" && body.includes("onRecallProgress?."))
            )
                found = node.arguments[0];
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(found, `missing ${name} callback`);
    return evaluate(
        "export const callback = " +
            ts.createPrinter().printNode(ts.EmitHint.Expression, found, ast),
        globals,
    ).callback;
}

function attempt(
    answer,
    {
        prefix = "",
        initialLength = 0,
        steps = [0.2, 0.4, 0.7, 1],
        manual = false,
    } = {},
) {
    const ref = (current) => ({ current });
    const noop = () => {};
    let cells = Array(answer.length).fill("");
    let cursor = 0;
    let now = 0;
    let pending;
    const observations = [];
    const progress = [];
    const resets = [];
    const globals = {
        ...hints,
        ...input,
        english: answer,
        currentSelection: 0,
        input: cells,
        hintLength: initialLength,
        initialCueLength: initialLength,
        initialCueRatio: 0,
        hintCount: Number(initialLength > 0),
        timedHintCount: 0,
        manualHints: manual,
        answerRevealed: false,
        learningMode: manual ? "free_recall" : undefined,
        isReadonly: false,
        isPaused: false,
        isKanaAnswer: /[ぁ-ゖ]/.test(answer),
        hintDelaysMs: [1000],
        cueSteps: steps,
        bombStatus: 0,
        automaticHintEvidenceRef: ref(
            hints.createAutomaticHintEvidence(answer, initialLength),
        ),
        completedRef: ref(false),
        revealedHintLengthRef: ref(initialLength),
        timedHintIndexRef: ref(0),
        inputStateRef: ref(cells),
        lastHintAtRef: ref(0),
        lastCorrectProgressAtRef: ref(0),
        maxCorrectPrefixRef: ref(0),
        firstKeyAtRef: ref(100),
        attemptCountRef: ref(1),
        incorrectInputCountRef: ref(0),
        hintEventsRef: ref([]),
        lastKeyWasSpaceRef: ref(false),
        kanaCommitSpansRef: ref([]),
        kanaComposing: "",
        getActiveElapsedMs: () => now,
        setTimeout: (fn, delay) => {
            pending = { fn, at: now + delay };
            return 1;
        },
        clearTimeout: () => {
            pending = null;
        },
        setInput: (next) => {
            cells = next;
            globals.inputStateRef.current = next;
        },
        setCurrentSelection: (next) => {
            cursor = next;
        },
        setRevealedHintLength: (next) => {
            globals.hintLength = next;
        },
        setAnswerRevealed: (value) => {
            globals.answerRevealed = value;
            globals.hintLength = value ? answer.length : 0;
            globals.hintCount = Number(value);
        },
        onHintChange: noop,
        setTimedHintCount: (update) => {
            globals.timedHintCount =
                typeof update === "function"
                    ? update(globals.timedHintCount)
                    : update;
            globals.hintCount =
                Number(initialLength > 0) + globals.timedHintCount;
        },
        setKanaComposing: noop,
        setCharInput: noop,
        onChangeInput: noop,
        onChangeInputRef: ref(noop),
        onHintChangeRef: ref(noop),
        onRecallComplete: (o) => observations.push(o),
        onSuccess: noop,
        onRecallProgress: (p) => progress.push(p),
        isSoundEffectsEnabled: () => false,
        console: { log: noop },
        shouldClearForTimedHint: romaji.shouldClearForTimedHint,
    };
    const render = () =>
        Object.assign(globals, { input: cells, currentSelection: cursor });
    globals.resetInput = () => {
        globals.attemptCountRef.current++;
        resets.push(true);
        globals.setInput(Array(answer.length).fill(""));
        cursor = 0;
    };
    const commit = (text, position = cursor) => {
        render();
        globals.currentSelection = position;
        const next = [...cells];
        Array.from(text).forEach((char, offset) => {
            next[position + offset] = char;
        });
        globals.setInput(next);
        callback("moveToNext", globals)(next, text.length);
        render();
    };
    const report = () => {
        render();
        callback("progress", globals)();
        return progress.at(-1);
    };
    if (prefix) commit(prefix);
    const cleanup = callback("timer", globals)();
    return {
        commit,
        report,
        observations,
        resets,
        globals,
        cleanup,
        hint() {
            if (manual) {
                callback("requestHint", globals)();
                return report();
            }
            assert.ok(pending, "expected a scheduled hint");
            now = pending.at;
            const fn = pending.fn;
            pending = null;
            fn();
            render();
            return report();
        },
    };
}

test("no hint produces an unaided observation through the real completion callback", () => {
    const a = attempt("abcdefghij");
    a.commit("abcdefghij");
    const o = a.observations[0];
    assert.equal(o.firstAttemptCorrect, true);
    assert.equal(o.finalCueRatio, 0);
    assert.equal(o.assistedPositions.length, 0);
    assert.equal(memory.evaluateRecall(o).retryNeed, "none");
    // A timer already queued when completion ran cannot reveal another hint.
    a.hint();
    assert.equal(a.globals.hintLength, 0);
});

test("automatic display alone is not reliance; only subsequent correct hinted commits count", () => {
    const a = attempt("abcdefghij", { prefix: "ab" });
    const before = a.hint();
    assert.equal(before.revealedHintChars, 4);
    assert.equal(before.hintCount, 0);
    assert.equal(before.assistedPositions.length, 0);
    a.commit("c");
    assert.equal(a.report().hintCount, 1);
    assert.equal(a.report().assistedPositions.join(), "2");
    a.commit("defghij");
    const o = a.observations[0];
    assert.equal(o.revealedHintChars, 4); // raw visibility remains diagnostic data
    assert.equal(o.assistedPositions.join(), "2,3");
    assert.equal(o.finalCueRatio, 0.2);
    assert.equal(o.additionalHintCount, 1);
    assert.equal(o.hintDiagnostics.version, "auto-hint-input-v1");
    assert.equal(o.hintDiagnostics.displayedHintCount, 1);
    assert.equal(o.hintDiagnostics.preHintCorrectChars, 2);
    assert.equal(o.hintDiagnostics.assistedHintChars, 2);
    assert.equal(memory.evaluateRecall(o).retryNeed, "confirm");
});

test("a full overlay after an independently typed prefix is partial reliance", () => {
    const a = attempt("abcdefghij", { prefix: "abcdefghi" });
    a.hint();
    a.commit("j");
    const o = a.observations[0];
    assert.equal(o.revealedHintChars, 10);
    assert.equal(o.finalCueRatio, 0.1);
    assert.equal(o.hintDiagnostics.preHintCorrectChars, 9);
    assert.equal(o.hintDiagnostics.assistedHintChars, 1);
    assert.equal(o.answerWasFullyRevealed, false);
    assert.equal(o.outcome, "cued_recall");
    assert.equal(memory.evaluateRecall(o).retryNeed, "confirm");
});

test("heavy assistance still requests a short retry at the shared 40% threshold", () => {
    const a = attempt("abcdefghij", { prefix: "abc", steps: [0.7, 1] });
    a.hint();
    a.commit("defghij");
    const o = a.observations[0];
    assert.equal(o.finalCueRatio, 0.4);
    assert.equal(o.answerWasFullyRevealed, false);
    assert.equal(memory.evaluateRecall(o).retryNeed, "short");
    assert.equal(memory.evaluateRecall(o).reason, "heavy_hint");
});

test("full reliance retains insufficient evidence and a short retry, ignoring layout spaces", () => {
    const a = attempt("a b", { steps: [1] });
    a.hint();
    a.commit("a b");
    const o = a.observations[0];
    assert.equal(o.assistedPositions.join(), "0,2");
    assert.equal(o.answerWasFullyRevealed, true);
    assert.equal(o.outcome, "relearned");
    assert.equal(
        memory.evaluateRecall(o).memoryEvidence,
        "insufficient_evidence",
    );
    assert.equal(memory.evaluateRecall(o).retryNeed, "short");
});

test("timed clearing preserves credit for correct cells and assistance across retries", () => {
    const a = attempt("abcdefghij", { prefix: "abx" });
    a.hint(); // shows abcd and clears the incorrect prefix
    assert.equal(a.globals.attemptCountRef.current, 2);
    a.commit("abcd");
    assert.equal(a.report().assistedPositions.join(), "2,3");
    a.commit("x", 2); // incorrect hinted cell clears input again
    a.commit("abcdefghij");
    const o = a.observations[0];
    assert.equal(o.assistedPositions.join(), "2,3");
    assert.equal(o.hintCount, 1);
    assert.equal(o.firstAttemptCorrect, false);
    assert.equal(o.hintDiagnostics.preHintCorrectChars, 2);
    assert.equal(o.hintDiagnostics.assistedHintChars, 2);
    assert.equal(memory.evaluateRecall(o).retryNeed, "confirm");
});

test("successive hints count used exposures once and never count an already recalled prefix", () => {
    const a = attempt("abcdefghij");
    a.hint(); // ab
    a.commit("abc");
    a.hint(); // abcd; c was already correct
    a.commit("defghij");
    const o = a.observations[0];
    assert.equal(o.assistedPositions.join(), "0,1,3");
    assert.equal(o.finalCueRatio, 0.3);
    assert.equal(o.hintCount, 2);
    assert.equal(o.additionalHintCount, 2);
});

test("kana multi-cell commits and out-of-order correct cells retain independent credit", () => {
    const a = attempt("ちゃわん", { steps: [1] });
    a.commit("ちゃ");
    a.commit("ん", 3);
    a.hint();
    a.commit("わ", 2);
    const o = a.observations[0];
    assert.equal(o.assistedPositions.join(), "2");
    assert.equal(o.finalCueRatio, 0.25);
    assert.equal(o.answerWasFullyRevealed, false);
});

test("initial duplicate-prompt cues count when used, not as extra timed hints", () => {
    const a = attempt("abcdefghij", { initialLength: 1 });
    a.commit("abcdefghij");
    const o = a.observations[0];
    assert.equal(o.assistedPositions.join(), "0");
    assert.equal(o.initialCueRatio, 0.1);
    assert.equal(o.finalCueRatio, 0.1);
    assert.equal(o.hintCount, 1);
    assert.equal(o.additionalHintCount, 0);
    assert.equal(o.firstAttemptCorrect, false);
    assert.equal(memory.evaluateRecall(o).retryNeed, "confirm");
});

test("new attempts start with fresh assistance evidence", () => {
    const first = attempt("abcdefghij", { steps: [1] });
    first.hint();
    first.commit("abcdefghij");
    const second = attempt("abcdefghij");
    second.commit("abcdefghij");
    assert.equal(second.observations[0].hintCount, 0);
    assert.equal(second.observations[0].answerWasFullyRevealed, false);
});

test("online recording uses the shared evaluation and logs normalized reliance", () => {
    const a = attempt("abcdefghij", { prefix: "abcdefghi" });
    a.hint();
    a.commit("j");
    const session = online.createOnlineMemorySession(
        "auto-hint",
        ["one", "two"],
        "user",
        {},
    );
    const id = online.nextOnlineRecommendation(session);
    const logs = [];
    online.recordOnlineRecall(session, id, a.observations[0], (d) =>
        logs.push(d),
    );
    assert.equal(logs[0].kind, "recall");
    assert.equal(logs[0].revealedHintChars, 10);
    assert.equal(logs[0].finalCueRatio, 0.1);
    assert.equal(logs[0].retryNeed, "confirm");
    assert.equal(logs[0].answerWasFullyRevealed, false);
    assert.equal(logs[0].diagnosticVersion, "online-learning-v2");
    assert.equal(logs[0].hintEvidenceVersion, "auto-hint-input-v1");
    assert.equal(logs[0].displayedFullAnswer, true);
    assert.equal(logs[0].preHintCorrectChars, 9);
    assert.equal(logs[0].assistedHintChars, 1);
    assert.equal(session.scheduler.retries[id].reason, "uncertain_recall");
});

test("offline manual full reveal remains a full hint even after a correct prefix", () => {
    const a = attempt("abcdefghij", { prefix: "abcdefghi", manual: true });
    const p = a.hint();
    assert.equal(p.answerWasFullyRevealed, true);
    assert.equal(p.hintEvents[0].source, "manual");
    assert.equal(p.hintEvents[0].correctBefore, 9);
    a.commit("j");
    const o = a.observations[0];
    assert.equal(o.finalCueRatio, 1);
    assert.equal(o.answerWasFullyRevealed, true);
    assert.equal(o.hintCount, 1);
    assert.equal(o.additionalHintCount, 1);
    assert.equal(o.assistedPositions.length, 0);
    assert.equal(o.firstAttemptCorrect, false);
    assert.equal(o.outcome, "relearned");
    assert.equal(memory.evaluateRecall(o).retryNeed, "short");
});

test("unfinished turns retain the latest hint summary once without changing learning state", () => {
    const a = attempt("abcdefghij", { prefix: "abcdefghi" });
    const p = a.hint();
    const session = online.createOnlineMemorySession(
        "unfinished",
        ["word"],
        "user",
        {},
    );
    const before = JSON.stringify({
        memory: session.memory,
        scheduler: session.scheduler,
    });
    const tracker = diagnostics.createRecallDiagnosticTracker();
    const bomb = { id: "bomb", turn: 1, holder: 0 };
    const key = diagnostics.recallAttemptKey("game", bomb);
    const current = { key, itemId: "word", answerLength: 10, progress: p };
    assert.equal(
        diagnostics.trackRecallDiagnostic(tracker, current, session).kind,
        "recall_started",
    );
    assert.equal(
        diagnostics.trackRecallDiagnostic(tracker, current, session),
        null,
    );
    const room = {
        gameId: "game",
        isStart: true,
        users: [{ id: "user" }],
        bombs: [bomb],
    };
    // Migration/repeated snapshots are not terminal events.
    assert.equal(
        diagnostics.finishRecallDiagnosticForSnapshot(
            tracker,
            session,
            { ...room, migrating: true },
            "user",
        ),
        null,
    );
    assert.equal(
        diagnostics.recallStartedDiagnostic(tracker, session).attemptKey,
        key,
    );
    const log = diagnostics.finishRecallDiagnosticForSnapshot(
        tracker,
        session,
        { ...room, bombs: [], losers: [{ id: "user" }] },
        "user",
    );
    assert.equal(log.kind, "unfinished");
    assert.equal(log.endReason, "exploded");
    assert.equal(log.displayedFullAnswer, true);
    assert.equal(log.preHintCorrectChars, 9);
    assert.equal(log.assistedHintChars, 0);
    assert.equal(log.hintCount, 0);
    assert.equal(log.displayedHintCount, 1);
    assert.equal(log.attemptKey, key);
    assert.equal(
        diagnostics.finishRecallDiagnostic(tracker, session, "game_ended"),
        null,
    );
    assert.equal(
        diagnostics.trackRecallDiagnostic(tracker, current, session),
        null,
    );
    assert.equal(
        JSON.stringify({
            memory: session.memory,
            scheduler: session.scheduler,
        }),
        before,
    );
});

test("success, repeated progress and the next game do not create duplicate unfinished summaries", () => {
    const session = online.createOnlineMemorySession(
        "finished",
        ["word"],
        "user",
        {},
    );
    const tracker = diagnostics.createRecallDiagnosticTracker();
    const progress = attempt("abcdefghij").report();
    const attemptInfo = {
        key: "game:bomb:1",
        itemId: "word",
        answerLength: 10,
        progress,
    };
    diagnostics.trackRecallDiagnostic(tracker, attemptInfo, session);
    assert.equal(
        diagnostics.completeRecallDiagnostic(tracker),
        attemptInfo.key,
    );
    assert.equal(
        diagnostics.finishRecallDiagnostic(tracker, session, "game_ended"),
        null,
    );
    assert.equal(
        diagnostics.trackRecallDiagnostic(tracker, attemptInfo, session),
        null,
    );
    assert.ok(
        diagnostics.trackRecallDiagnostic(
            tracker,
            { ...attemptInfo, key: "next-game:bomb:1" },
            session,
        ),
    );
    assert.equal(
        diagnostics.finishRecallDiagnostic(tracker, session, "room_left")
            .endReason,
        "room_left",
    );
});
