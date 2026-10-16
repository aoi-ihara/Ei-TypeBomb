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
    assert.deepEqual(orientImportPair("apple", "りんご"), {
        jp: "apple",
        en: "りんご",
    });
    assert.deepEqual(orientImportPair("桜", "さくら"), {
        jp: "桜",
        en: "さくら",
    });
    assert.deepEqual(orientImportPair("かき", "apple"), {
        jp: "かき",
        en: "apple",
    });
    assert.deepEqual(orientImportPair("apple", "かな"), {
        jp: "かな",
        en: "apple",
    });
    assert.deepEqual(orientImportPair("abc", "かな"), {
        jp: "abc",
        en: "かな",
    });
    assert.deepEqual(orientImportPair("a", "bb"), { jp: "a", en: "bb" });
    assert.deepEqual(orientImportPair("bb", "a"), { jp: "a", en: "bb" });
    assert.deepEqual(orientImportPair("漢字", "apple"), {
        jp: "漢字",
        en: "apple",
    });
    assert.deepEqual(orientImportPair("a", "b"), { jp: "a", en: "b" });
});

test("CSV chooses one answer column for all rows, with quoted commas and unicode", () => {
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
        parseImportedPairs(
            '[{"りんご":"apple"},{"apple":"ねこ"},{"桜の読み方":"さくら"}]',
        ),
        [
            { jp: "りんご", en: "apple" },
            { jp: "ねこ", en: "apple" },
            { jp: "桜の読み方", en: "さくら" },
        ],
    );
    assert.deepEqual(
        parseImportedPairs('[{"question":"りんご","answer":"apple"}]'),
        [{ jp: "りんご", en: "apple" }],
    );
    assert.deepEqual(parseImportedPairs('[{"jp":"りんご","en":"apple"}]'), [
        { jp: "りんご", en: "apple" },
    ]);
});

test("JSON export roundtrips pair records", () => {
    const imported = [
        { prompt: "りんご", answer: "apple" },
        { prompt: "桜の読み方", answer: "さくら" },
    ];
    const exportText = exportAnswerPairs(imported);
    assert.deepEqual(JSON.parse(exportText), {
        りんご: "apple",
        桜の読み方: "さくら",
    });
    assert.deepEqual(parseImportedPairs(exportText), [
        { jp: "りんご", en: "apple" },
        { jp: "桜の読み方", en: "さくら" },
    ]);
});

test("restrict answer to ASCII alphanumeric, hiragana, hyphen, spaces and specified punctuation", () => {
    assert.equal(isAllowedTypingAnswer("A9- ひらがなー,.!?、。！？"), true);
    for (const invalid of [
        "漢字",
        "カタカナ",
        "é",
        "😀",
        "テスト",
        "ABC＿123",
        "",
    ]) {
        assert.equal(isAllowedTypingAnswer(invalid), false, invalid);
    }
    assert.equal(
        filterTypingAnswer("漢字カタカナabc-さくらー?!。"),
        "abc-さくらー?!。",
    );
});

test("CSV and JSON preserve prolonged sound marks", () => {
    assert.deepEqual(parseImportedPairs("食べ物は？,らーめん"), [
        { jp: "食べ物は？", en: "らーめん" },
    ]);
    assert.deepEqual(parseImportedPairs('{"食べ物は？":"らーめん"}'), [
        { jp: "食べ物は？", en: "らーめん" },
    ]);
});

test("invalid answer, malformed JSON and invalid CSV raise readable errors", () => {
    assert.deepEqual(parseImportedPairs("漢字,漢語"), [
        { jp: "漢字", en: "漢語" },
    ]);
    assert.deepEqual(parseImportedPairs('[{"問題":"漢字"}]'), [
        { jp: "問題", en: "漢字" },
    ]);
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
    assert.deepEqual(
        parseImportedPairs(exported),
        original.map((item) => ({ jp: item.prompt, en: item.answer })),
    );
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
    for (const kana of new Set(
        Object.values(ROMAJI).flatMap((value) => Array.from(value)),
    )) {
        assert.equal(isAllowedTypingAnswer(kana), true, kana);
    }
    for (const kana of ["ゎ", "ゐ", "ゑ", "ゔ", "ゕ", "ゖ"]) {
        assert.equal(isAllowedTypingAnswer(kana), false, kana);
        assert.deepEqual(
            parseImportedPairs(
                JSON.stringify([{ question: "test", answer: kana }]),
            ),
            [{ jp: "test", en: kana }],
        );
    }
});

test("single JSON object is an explicit question-to-answer mapping", () => {
    assert.deepEqual(
        parseImportedPairs(
            '{"ねこ":"cat","日本の憲法の名前は？":"にほんこくけんぽう"}',
        ),
        [
            { jp: "ねこ", en: "cat" },
            { jp: "日本の憲法の名前は？", en: "にほんこくけんぽう" },
        ],
    );
    assert.deepEqual(parseImportedPairs('{"what is one":"yes"}'), [
        { jp: "what is one", en: "yes" },
    ]);
    assert.deepEqual(
        parseImportedPairs('{"日本の憲法の名前は？":"日本国憲法"}'),
        [{ jp: "日本の憲法の名前は？", en: "日本国憲法" }],
    );
});

test("duplicate prompts cannot be silently lost during JSON object export", () => {
    assert.throws(
        () =>
            exportAnswerPairs([
                { prompt: "ねこ", answer: "cat" },
                { prompt: "ねこ", answer: "kitten" },
            ]),
        /重複/,
    );
    assert.deepEqual(
        parseImportedPairs(
            exportAnswerPairs([
                { prompt: "what is one", answer: "yes" },
                { prompt: "ねこ", answer: "cat" },
            ]),
        ),
        [
            { jp: "what is one", en: "yes" },
            { jp: "ねこ", en: "cat" },
        ],
    );
});

test("user's thirty CSV quiz rows all import; invalid answers are flagged only after import", () => {
    const csv = [
        "日本の首都は？,とうきょう",
        "日本で一番高い山は？,ふじさん",
        "日本の通貨は？,えん",
        "アメリカの首都は？,わしんとん",
        "フランスの首都は？,ぱり",
        "1+1は？,2",
        "2+3は？,5",
        "5×5は？,25",
        "10÷2は？,5",
        "100の半分は？,50",
        "りんごを英語で？,apple",
        "ねこを英語で？,cat",
        "いぬを英語で？,dog",
        "みずを英語で？,water",
        "ほんを英語で？,book",
        "太陽を英語で？,sun",
        "月を英語で？,moon",
        "赤を英語で？,red",
        "青を英語で？,blue",
        "白を英語で？,white",
        "1年は何ヶ月？,12",
        "1週間は何日？,7",
        "1日は何時間？,24",
        "1時間は何分？,60",
        "1分は何秒？,60",
        "春の次の季節は？,なつ",
        "夏の次の季節は？,あき",
        "秋の次の季節は？,ふゆ",
        "冬の次の季節は？,はる",
        "地球の衛星は？,つき",
    ].join("\n");
    const imported = parseImportedPairs(csv);
    assert.equal(imported.length, 30);
    // Across all 30 rows, left has 84 counted chars and right has 83.
    // Therefore the right column is the answer for *every* row.
    assert.deepEqual(imported[5], { jp: "1+1は？", en: "2" });
    assert.equal(isAllowedTypingAnswer(imported[5].en), true);
    assert.deepEqual(imported[0], { jp: "日本の首都は？", en: "とうきょう" });
    assert.deepEqual(imported[29], { jp: "地球の衛星は？", en: "つき" });
});

test("malformed input still fails even though invalid answer chars are accepted", () => {
    assert.throws(() => parseImportedPairs("a,b,c"), /2列/);
    assert.throws(() => parseImportedPairs("a,"), /問題と回答/);
    assert.throws(
        () => parseImportedPairs('[{"question":"x","answer":123}]'),
        /問題と回答/,
    );
    assert.throws(() => parseImportedPairs("{missing"), /構文/);
});

test("whole CSV chooses a single column even when individual rows favor the other", () => {
    // First row alone would pick the right column (5 vs 3 is < 2x).
    // Across the CSV, the left column dominates: 15 vs 5.
    const leftWins = parseImportedPairs("apple,りんご\nabcdefghij,xx");
    assert.deepEqual(leftWins, [
        { jp: "りんご", en: "apple" },
        { jp: "xx", en: "abcdefghij" },
    ]);

    // The first row alone would choose the left column, but the whole CSV
    // chooses right. 5 + 1 vs 2 + 10.
    const rightWins = parseImportedPairs("apple,かな\na,abcdefghij");
    assert.deepEqual(rightWins, [
        { jp: "apple", en: "かな" },
        { jp: "a", en: "abcdefghij" },
    ]);
});

test("aggregate CSV threshold requires a strict longer side with >= 2x count", () => {
    assert.deepEqual(parseImportedPairs("aaaa,xx\nbb,x"), [
        { jp: "xx", en: "aaaa" },
        { jp: "x", en: "bb" },
    ]); // left 6 vs right 3, exact boundary
    assert.deepEqual(parseImportedPairs("aaaa,xx\nb,x"), [
        { jp: "aaaa", en: "xx" },
        { jp: "b", en: "x" },
    ]); // left 5 vs right 3, below 2x
});
