import test from "node:test";
import assert from "node:assert/strict";
import { exportAnswerPairs, parseImportedPairs } from "../lib/room/importWords.mjs";

test("JSON export preserves duplicate prompts instead of throwing", () => {
    const exported = exportAnswerPairs([
        { prompt: "ねこ", answer: "cat" },
        { prompt: "ねこ", answer: "kitten" },
        { prompt: "いぬ", answer: "dog" },
    ]);

    assert.deepEqual(JSON.parse(exported), [
        { question: "ねこ", answer: "cat" },
        { question: "ねこ", answer: "kitten" },
        { question: "いぬ", answer: "dog" },
    ]);

    assert.deepEqual(parseImportedPairs(exported), [
        { jp: "ねこ", en: "cat" },
        { jp: "ねこ", en: "kitten" },
        { jp: "いぬ", en: "dog" },
    ]);
});
