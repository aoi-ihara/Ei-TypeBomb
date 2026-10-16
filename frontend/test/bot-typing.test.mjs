import test from "node:test";
import assert from "node:assert/strict";
import {
    getBotRomanKeys,
    getBotTypingFrames,
} from "../lib/playground/bot-typing.mjs";
import { decodeKanaProgress } from "../lib/romaji-input.mjs";

test("bot types roma-ji first and only shows ちゃ after tya completes", () => {
    assert.deepEqual(getBotRomanKeys("ちゃ"), ["t", "y", "a"]);
    assert.deepEqual(getBotTypingFrames("ちゃ"), ["t", "ty", "ちゃ"]);
});

test("bot uses one roman keystroke per frame for ordinary kana", () => {
    assert.deepEqual(getBotTypingFrames("さくら"), [
        "s",
        "さ",
        "さk",
        "さく",
        "さくr",
        "さくら",
    ]);
    assert.deepEqual(getBotTypingFrames("きょう"), [
        "k",
        "ky",
        "きょ",
        "きょう",
    ]);
    assert.deepEqual(getBotTypingFrames("ふぁ"), ["f", "ふぁ"]);
    assert.deepEqual(getBotTypingFrames("ふぃ"), ["f", "ふぃ"]);
});

test("bot handles ん followed by な-row without duplicated n frames", () => {
    const donna = getBotTypingFrames("だんな");
    assert.deepEqual(donna, ["d", "だ", "だn", "だんn", "だんな"]);
    const hello = getBotTypingFrames("こんにちは");
    assert.equal(hello.at(-1), "こんにちは");
    assert.ok(hello.includes("こんn"));
    // The carried consonant shows as an unfinished n; no redundant identical
    // extra frame should be introduced when advancing into に.
    assert.ok(hello.every((frame, i) => i === 0 || frame !== hello[i - 1]));
});

test("small tsu and digraphs are typed by the shared romanization", () => {
    const frames = getBotTypingFrames("がっこう");
    assert.equal(frames.at(-1), "がっこう");
    assert.ok(frames.includes("がx"));
    assert.ok(frames.includes("がxt"));
    assert.ok(frames.includes("がっ"));
    assert.ok(frames.includes("がっk"));
});

test("English and numbers keep the existing one-character timing", () => {
    assert.deepEqual(getBotTypingFrames("cat"), ["c", "ca", "cat"]);
    assert.deepEqual(getBotTypingFrames("25"), ["2", "25"]);
    assert.deepEqual(getBotTypingFrames(""), []);
});

test("kana, spaces, Latin, and punctuation can mix in the same answer", () => {
    assert.deepEqual(getBotTypingFrames("あ い"), ["あ", "あ ", "あ い"]);
    assert.deepEqual(getBotTypingFrames("さ-a"), ["s", "さ", "さ-", "さ-a"]);
    const frames = getBotTypingFrames("きょう！");
    assert.equal(frames.at(-1), "きょう！");
    assert.equal(frames[1], "ky");
});

test("remote read-only view decodes unfinished roman keys into the active syllable", () => {
    for (const answer of [
        "ちゃ",
        "さくら",
        "だんな",
        "がっこう",
        "ふぁ",
        "あ い",
    ]) {
        for (const frame of getBotTypingFrames(answer)) {
            const state = decodeKanaProgress(answer, frame);
            assert.equal(state.committed + state.composing, frame);
            assert.ok(answer.startsWith(state.committed));
        }
    }
});

test("unsupported kana cannot trap a Playground CPU turn", () => {
    assert.deepEqual(getBotTypingFrames("ゔ"), ["ゔ"]);
});
