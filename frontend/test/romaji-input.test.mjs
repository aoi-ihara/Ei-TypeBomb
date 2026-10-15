import test from "node:test";
import assert from "node:assert/strict";
import {
    advanceKanaInput, decodeKanaProgress, encodeKanaProgress,
    hasHiragana, kanaCompositionLayout, romanSlotCount,
    advanceEditableKanaAt, editKanaCell, nextKanaCursor,
    shouldClearForTimedHint,
} from "../lib/romaji-input.mjs";

function type(answer, keys) {
    let progress = { committed: "", composing: "" };
    for (const key of keys) {
        const result = advanceKanaInput(answer, progress, key);
        assert.equal(result.accepted, true, `Rejected "${key}" in "${keys}" for "${answer}" at ${JSON.stringify(progress)}`);
        progress = { committed: result.committed, composing: result.composing };
    }
    return progress;
}

test("common syllables, two-/three-letter romanization", () => {
    assert.deepEqual(type("さ", "sa"), { committed: "さ", composing: "" });
    assert.deepEqual(type("し", "shi"), { committed: "し", composing: "" });
    assert.deepEqual(type("し", "si"), { committed: "し", composing: "" });
    assert.deepEqual(type("ちゃ", "tya"), { committed: "ちゃ", composing: "" });
    assert.deepEqual(type("ちゃ", "cha"), { committed: "ちゃ", composing: "" });
    assert.deepEqual(type("きょう", "kyou"), { committed: "きょう", composing: "" });
});
test("progressive roman boxes keep the current letter active", () => {
    let state = { committed: "", composing: "" };
    assert.equal(romanSlotCount(state.composing), 1);
    let result = advanceKanaInput("ちゃ", state, "t");
    assert.equal(result.composing, "t");
    assert.equal(romanSlotCount(result.composing), 2);
    state = { committed: result.committed, composing: result.composing };
    result = advanceKanaInput("ちゃ", state, "y");
    assert.equal(result.composing, "ty");
    assert.equal(romanSlotCount(result.composing), 3);
    state = { committed: result.committed, composing: result.composing };
    result = advanceKanaInput("ちゃ", state, "a");
    assert.equal(result.committed, "ちゃ");
    assert.equal(romanSlotCount(result.composing), 1);
});
test("ん uses the second n as start of the following n-row kana", () => {
    assert.deepEqual(type("こんにちは", "konnichiha"), { committed: "こんにちは", composing: "" });
    assert.deepEqual(type("かんな", "kanna"), { committed: "かんな", composing: "" });
    assert.deepEqual(type("かんじ", "kanji"), { committed: "かんじ", composing: "" });
    assert.deepEqual(type("かんあ", "kan'a"), { committed: "かんあ", composing: "" });
});
test("っ supports doubled consonants and small-tsu notation", () => {
    assert.deepEqual(type("がっこう", "gakkou"), { committed: "がっこう", composing: "" });
    assert.deepEqual(type("がっこう", "gaxtukou"), { committed: "がっこう", composing: "" });
});
test("mixes kana, English, spaces and hyphens without changing English keys", () => {
    assert.deepEqual(type("さ-a", "sa-a"), { committed: "さ-a", composing: "" });
    assert.deepEqual(type("さ a", "sa a"), { committed: "さ a", composing: "" });
    assert.deepEqual(type("apple", "apple"), { committed: "apple", composing: "" });
    assert.equal(hasHiragana("apple"), false);
    assert.equal(hasHiragana("さ-a"), true);
});
test("invalid input never alters committed kana or composition", () => {
    const progress = { committed: "", composing: "t" };
    const result = advanceKanaInput("ちゃ", progress, "z");
    assert.equal(result.accepted, false);
    assert.deepEqual({ committed: result.committed, composing: result.composing }, progress);
});
test("wire representation round-trips mid-composition and completed syllables", () => {
    for (const progress of [
        { committed: "", composing: "t" },
        { committed: "", composing: "ty" },
        { committed: "こ", composing: "n" },
        { committed: "こん", composing: "n" },
        { committed: "ちゃ", composing: "" },
    ]) {
        const answer = progress.committed.startsWith("こ") ? "こんにちは" : "ちゃ";
        assert.deepEqual(decodeKanaProgress(answer, encodeKanaProgress(progress)), progress);
    }
});

test("ん followed by n-row kana accepts shared or explicit extra n", () => {
    assert.deepEqual(type("だんな", "danna"), { committed: "だんな", composing: "" });
    assert.deepEqual(type("だんな", "dannna"), { committed: "だんな", composing: "" });
    assert.deepEqual(type("こんにちは", "konnnichiha"), { committed: "こんにちは", composing: "" });
    assert.deepEqual(type("かんな", "kan'na"), { committed: "かんな", composing: "" });
});

test("roman boxes expand immediately when the whole syllable is hinted", () => {
    assert.deepEqual(
        kanaCompositionLayout("ちゃ", 0, "t", 2),
        { slots: 3, hintRoman: "tya", occupies: 1 },
    );
    assert.deepEqual(
        kanaCompositionLayout("ちゃ", 0, "ty", 2),
        { slots: 3, hintRoman: "tya", occupies: 2 },
    );
    assert.deepEqual(
        kanaCompositionLayout("ちゃ", 0, "t", 0),
        { slots: 2, hintRoman: "", occupies: 1 },
    );
    assert.deepEqual(
        kanaCompositionLayout("ちゃ", 0, "ty", 0),
        { slots: 3, hintRoman: "", occupies: 2 },
    );
    assert.deepEqual(
        kanaCompositionLayout("ちゃ", 0, "ch", 2),
        { slots: 3, hintRoman: "cha", occupies: 2 },
    );
});

test("incomplete kana hints do not reveal unseen small kana", () => {
    assert.deepEqual(
        kanaCompositionLayout("ちゃ", 0, "t", 1),
        { slots: 2, hintRoman: "", occupies: 1 },
    );
    assert.deepEqual(
        kanaCompositionLayout("きょう", 0, "ky", 2),
        { slots: 3, hintRoman: "kyo", occupies: 2 },
    );
    assert.deepEqual(
        kanaCompositionLayout("きょう", 2, "u", 3),
        { slots: 2, hintRoman: "u", occupies: 1 },
    );
});

test("incorrect kana stays until the whole answer is attempted", () => {
    const answer = "さくら";
    let cells = ["", "", ""];
    const sa = editKanaCell(answer, cells, 0, "s", "a");
    assert.equal(sa.accepted, true);
    assert.deepEqual(sa.cells, ["さ", "", ""]);
    assert.equal(sa.complete, false);

    // た is wrong for く, but is still a valid kana input.
    const ta = editKanaCell(answer, sa.cells, 1, "t", "a");
    assert.deepEqual(ta.cells, ["さ", "た", ""]);
    assert.equal(ta.complete, false);
    assert.equal(ta.correct, false);
    const ra = editKanaCell(answer, ta.cells, 2, "r", "a");
    assert.deepEqual(ra.cells, ["さ", "た", "ら"]);
    assert.equal(ra.complete, true);
    assert.equal(ra.correct, false);
});

test("clicking or arrowing to an earlier kana allows editing without clearing later letters", () => {
    const answer = "さくら";
    const existing = ["さ", "た", "ら"];
    assert.equal(nextKanaCursor(2, -1, 3), 1);
    assert.equal(nextKanaCursor(1, -1, 3), 0);
    assert.equal(nextKanaCursor(0, -1, 3), 0);
    assert.equal(nextKanaCursor(2, 1, 3), 2);

    const correction = editKanaCell(answer, existing, 1, "k", "u");
    assert.deepEqual(correction.cells, ["さ", "く", "ら"]);
    assert.equal(correction.complete, true);
    assert.equal(correction.correct, true);
});

test("skipping ahead never treats the last box as the end of a word", () => {
    const result = editKanaCell("さくら", ["", "", ""], 2, "r", "a");
    assert.deepEqual(result.cells, ["", "", "ら"]);
    assert.equal(result.complete, false);
    assert.equal(result.correct, false);
});

test("impossible romaji fails immediately; a valid but wrong kana does not", () => {
    for (const [prefix, key] of [["s", "q"], ["z", "z"], ["t", "z"]]) {
        const failure = editKanaCell("てすと", ["", "", ""], 0, prefix, key);
        assert.equal(failure.accepted, false);
        assert.deepEqual(failure.cells, ["", "", ""]);
    }
    const wrongButValid = editKanaCell("てすと", ["", "", ""], 0, "t", "a");
    assert.equal(wrongButValid.accepted, true);
    assert.deepEqual(wrongButValid.cells, ["た", "", ""]);
    assert.equal(wrongButValid.complete, false);
});

test("editable typing supports kana combinations and n-row carry", () => {
    assert.deepEqual(
        advanceEditableKanaAt("ちゃ", 0, "ty", "a"),
        { accepted: true, emitted: "ちゃ", composing: "" },
    );
    assert.deepEqual(
        advanceEditableKanaAt("だんな", 1, "n", "n"),
        { accepted: true, emitted: "ん", composing: "n" },
    );
    assert.deepEqual(
        advanceEditableKanaAt("だんな", 2, "n", "a"),
        { accepted: true, emitted: "な", composing: "" },
    );
    assert.deepEqual(
        advanceEditableKanaAt("だんな", 2, "n", "n"),
        { accepted: true, emitted: "", composing: "n" },
    );
    const first = editKanaCell("ちゃ", ["", ""], 0, "ty", "a");
    assert.deepEqual(first.cells, ["ち", "ゃ"]);
    assert.equal(first.correct, true);
});

test("editing a kana + English mixed answer remains position-aware", () => {
    const next = editKanaCell("さ-a", ["さ", "", ""], 1, "", "-");
    assert.deepEqual(next.cells, ["さ", "-", ""]);
    const wrong = editKanaCell("さ-a", next.cells, 2, "", "b");
    assert.deepEqual(wrong.cells, ["さ", "-", "b"]);
    assert.equal(wrong.complete, true);
    assert.equal(wrong.correct, false);
    const corrected = editKanaCell("さ-a", wrong.cells, 2, "", "a");
    assert.equal(corrected.correct, true);
});

test("fa and fi convert as combined kana, including optional fe and fo", () => {
    const examples = [
        ["ふぁ", "fa"],
        ["ふぃ", "fi"],
        ["ふぇ", "fe"],
        ["ふぉ", "fo"],
    ];
    for (const [kana, roman] of examples) {
        assert.deepEqual(type(kana, roman), { committed: kana, composing: "" });

        const first = editKanaCell(kana, Array.from(kana, () => ""), 0, "", "f");
        assert.equal(first.advance, 0);
        assert.equal(first.composing, "f");
        assert.equal(first.complete, false);

        const second = editKanaCell(kana, first.cells, 0, "f", roman[1]);
        assert.deepEqual(second.cells, Array.from(kana));
        assert.equal(second.advance, 2);
        assert.equal(second.correct, true);

        const unhinted = kanaCompositionLayout(kana, 0, "f", 0);
        assert.deepEqual(unhinted, { slots: 2, hintRoman: "", occupies: 1 });
        const hinted = kanaCompositionLayout(kana, 0, "f", 2);
        assert.equal(hinted.hintRoman, roman);
    }
});

test("timed hints never erase editable kana or its unhinted cells", () => {
    const cases = [
        { answer: "さくら", cells: ["さ", "た", ""], hintLength: 0 },
        { answer: "さくら", cells: ["さ", "た", ""], hintLength: 1 },
        { answer: "さくら", cells: ["さ", "た", ""], hintLength: 3 },
        { answer: "ふぁ", cells: ["ふ", ""], hintLength: 2 },
    ];
    for (const { answer, cells, hintLength } of cases) {
        assert.equal(shouldClearForTimedHint(answer, cells, hintLength), false);
    }
    // Existing English behaviour must be preserved.
    assert.equal(shouldClearForTimedHint("cat", ["c", "x", ""], 1), false);
    assert.equal(shouldClearForTimedHint("cat", ["c", "x", ""], 2), true);
});

test("input in a blank unhinted kana slot remains editable through completion", () => {
    const answer = "ふぁく";
    const started = editKanaCell(answer, ["", "", ""], 0, "", "f");
    assert.equal(started.advance, 0);
    assert.equal(started.complete, false);
    assert.equal(shouldClearForTimedHint(answer, started.cells, 0), false);
    const composed = editKanaCell(answer, started.cells, 0, started.composing, "a");
    assert.deepEqual(composed.cells, ["ふ", "ぁ", ""]);
    assert.equal(composed.complete, false);
    assert.equal(shouldClearForTimedHint(answer, composed.cells, 0), false);
    const finished = editKanaCell(answer, composed.cells, 2, "k", "u");
    assert.deepEqual(finished.cells, ["ふ", "ぁ", "く"]);
    assert.equal(finished.correct, true);
});

test("てすと -> たちつ: first two wrong kana are held; third ends the failed attempt", () => {
    const answer = "てすと";
    let cells = ["", "", ""];
    const steps = [
        ["t", "a", ["た", "", ""]],
        ["ch", "i", ["た", "ち", ""]],
        ["ts", "u", ["た", "ち", "つ"]],
    ];
    for (const [prefix, vowel, expected] of steps) {
        const position = cells.findIndex((letter) => letter === "");
        const next = editKanaCell(answer, cells, position, prefix, vowel);
        assert.equal(next.accepted, true);
        assert.deepEqual(next.cells, expected);
        assert.equal(next.complete, position === 2);
        assert.equal(next.correct, false);
        cells = next.cells;
    }
    // The UI resets to an empty array and index 0 on the final incorrect kana.
    assert.deepEqual(Array.from(answer, () => ""), ["", "", ""]);
});

test("valid complete sequences preserve input until the last kana even without hints", () => {
    let cells = ["", "", ""];
    for (const [position, consonant, vowel, expected] of [
        [0, "t", "a", ["た", "", ""]],
        [1, "ch", "i", ["た", "ち", ""]],
        [2, "ts", "u", ["た", "ち", "つ"]],
    ]) {
        const result = editKanaCell("てすと", cells, position, consonant, vowel);
        assert.equal(result.accepted, true);
        assert.deepEqual(result.cells, expected);
        cells = result.cells;
    }
});
