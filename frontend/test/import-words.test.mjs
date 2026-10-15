import test from "node:test";
import assert from "node:assert/strict";
import {
    countTypingCharacters,
    exportAnswerPairs,
    filterTypingAnswer,
    isAllowedTypingAnswer,
    orientImportPair,
    parseImportedPairs,
} from "../lib/room/importWords.mjs";

test("counts only alphanumeric + hiragana, excluding punctuation and kanji", () => {
    assert.equal(countTypingCharacters("a2あ!.、漢"), 3);
    assert.equal(countTypingCharacters("こんにちは"), 5);
});

test(">= 2x chooses the longer side, otherwise chooses the right", () => {
    assert.deepEqual(orientImportPair("apple", "りんご"), { jp: "apple", en: "りんご" });
    assert.deepEqual(orientImportPair("桜", "さくら"), { jp: "桜", en: "さくら" });
    assert.deepEqual(orientImportPair("かき", "apple"), { jp: "かき", en: "apple" });
    assert.deepEqual(orientImportPair("apple", "かな"), { jp: "かな", en: "apple" });
    assert.deepEqual(orientImportPair("abc", "かな"), { jp: "abc", en: "かな" });
    assert.deepEqual(orientImportPair("a", "bb"), { jp: "a", en: "bb" });
    assert.deepEqual(orientImportPair("bb", "a"), { jp: "a", en: "bb" });
    assert.deepEqual(orientImportPair("漢字", "apple"), { jp: "漢字", en: "apple" });
    assert.deepEqual(orientImportPair("a", "b"), { jp: "a", en: "b" });
});

test("CSV detection is per row with quoted commas and unicode", () => {
    assert.deepEqual(parseImportedPairs("apple,りんご\n桜,さくら\nあ,ab"), [
        { jp: "apple", en: "りんご" },
        { jp: "桜", en: "さくら" },
        { jp: "あ", en: "ab" },
    ]);
    assert.deepEqual(parseImportedPairs('"質問,説明","よい、いい!"'), [
        { jp: "質問,説明", en: "よい、いい!" },
    ]);
    assert.deepEqual(parseImportedPairs("問,あ\r\n"), [{ jp: "問", en: "あ" }]);
});

test("JSON array of question-answer maps uses the same orientation", () => {
    assert.deepEqual(
        parseImportedPairs('[{"りんご":"apple"},{"apple":"ねこ"},{"桜の読み方":"さくら"}]'),
        [
            { jp: "りんご", en: "apple" },
            { jp: "ねこ", en: "apple" },
            { jp: "桜の読み方", en: "さくら" },
        ],
    );
    assert.deepEqual(parseImportedPairs('[{"question":"りんご","answer":"apple"}]'), [
        { jp: "りんご", en: "apple" },
    ]);
    assert.deepEqual(parseImportedPairs('[{"jp":"りんご","en":"apple"}]'), [
        { jp: "りんご", en: "apple" },
    ]);
});

test("JSON export roundtrips pair records", () => {
    const imported = [{ prompt: "りんご", answer: "apple" }, { prompt: "桜の読み方", answer: "さくら" }];
    const exportText = exportAnswerPairs(imported);
    assert.deepEqual(JSON.parse(exportText), [{ question: "りんご", answer: "apple" }, { question: "桜の読み方", answer: "さくら" }]);
    assert.deepEqual(parseImportedPairs(exportText), [{ jp: "りんご", en: "apple" }, { jp: "桜の読み方", en: "さくら" }]);
});

test("restrict answer to ASCII alphanumeric, hiragana, hyphen, spaces and specified punctuation", () => {
    assert.equal(isAllowedTypingAnswer("A9- ひらがな,.!?、。！？"), true);
    for (const invalid of ["漢字", "カタカナ", "é", "😀", "テスト", "ABC＿123", ""]) {
        assert.equal(isAllowedTypingAnswer(invalid), false, invalid);
    }
    assert.equal(filterTypingAnswer("漢字カタカナabc-さくら?!。"), "abc-さくら?!。");
});

test("invalid answer, malformed JSON and invalid CSV raise readable errors", () => {
    assert.throws(() => parseImportedPairs("漢字,漢語"), /回答/);
    assert.throws(() => parseImportedPairs('[{"問題":"漢字"}]'), /回答/);
    assert.throws(() => parseImportedPairs('[{"a":"b"'), /構文/);
    assert.throws(() => parseImportedPairs("one,two,three"), /2列/);
    assert.throws(() => parseImportedPairs('[{"問題":"a","追加":"b"}]'), /1組/);
});

test("role-labelled export roundtrips even when prompt is more than 2x answer", () => {
    const original = [
        { prompt: "what is one", answer: "yes" },
        { prompt: "長い漢字の説明を含む問題", answer: "あ" },
    ];
    const exported = exportAnswerPairs(original);
    assert.deepEqual(parseImportedPairs(exported), original.map(item => ({ jp: item.prompt, en: item.answer })));
    // Unlabelled one-pair JSON remains subject to the user-requested heuristic.
    assert.deepEqual(parseImportedPairs('[{"what is one":"yes"}]'), [
        { jp: "yes", en: "what is one" },
    ]);
    // Even legacy role-labelled records retain their original direction.
    assert.deepEqual(parseImportedPairs('[{"jp":"what is one","en":"yes"}]'), [
        { jp: "what is one", en: "yes" },
    ]);
});

test("reject unsupported kana but permit all kana emitted by romanizer", async () => {
    const { ROMAJI } = await import("../lib/romaji-input.mjs");
    for (const kana of new Set(Object.values(ROMAJI).flatMap(value => Array.from(value)))) {
        assert.equal(isAllowedTypingAnswer(kana), true, kana);
    }
    for (const kana of ["ゎ", "ゐ", "ゑ", "ゔ", "ゕ", "ゖ"]) {
        assert.equal(isAllowedTypingAnswer(kana), false, kana);
        assert.throws(() => parseImportedPairs(JSON.stringify([{ question: "test", answer: kana }])), /回答/);
    }
});
