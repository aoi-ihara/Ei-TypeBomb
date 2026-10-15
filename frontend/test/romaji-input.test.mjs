import test from "node:test";
import assert from "node:assert/strict";
import {
    advanceKanaInput, decodeKanaProgress, encodeKanaProgress,
    hasHiragana, kanaCompositionLayout, romanSlotCount,
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
