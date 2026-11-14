import assert from "node:assert/strict";
import test from "node:test";
import { parseImportedWords } from "../lib/room/importWords";
import { generateReadings, prepareItemReadings } from "../lib/room/readings";
import type { Item } from "../type";

test("IPADIC exact readings, fully covered compounds and unknown words", async () => {
    for (const [word, expected] of Object.entries({
        学校: ["がっこう"], 生物: ["せいぶつ", "なまもの"], 人気: ["にんき", "ひとけ"],
        明日: ["あした", "あす"], 情報処理技術者: ["じょうほうしょりぎじゅつしゃ"],
        酸化還元反応: ["さんかかんげんはんのう"], 龘龘: [], かな: [], english: [],
    })) assert.deepEqual(await generateReadings(word), expected);
});

test("only reuse current readings from persisted answers", async () => {
    const input: Item = { id: "a", type: "typed_recall", prompt: "問", answer: "学校",
        readings: ["うそ"], reading_version: 1 };
    const [saved] = await prepareItemReadings([input]);
    assert.deepEqual(saved.readings, ["がっこう"]);
    assert.equal(saved.reading_version, 2);
    const fail = async () => { throw Error("dictionary unavailable"); };
    assert.deepEqual(await prepareItemReadings([input], [saved], fail), [saved]);
    for (const stored of [{ ...input, reading_version: 0 }, { ...input, answer: "人気" },
        { ...input, reading_version: undefined }]) {
        assert.deepEqual(await prepareItemReadings([input], [stored]), [saved]);
    }
    const [retry] = await prepareItemReadings([input], [], fail);
    assert.equal(retry.reading_version, undefined);
    assert.equal(retry.readings, undefined);
    assert.deepEqual(await prepareItemReadings([retry], [retry]), [saved]);
    const [unknown] = await prepareItemReadings([{ ...input, answer: "龘龘" }]);
    assert.equal(unknown.reading_version, 2);
    assert.deepEqual(unknown.readings, []);
    const [english] = await prepareItemReadings([{ ...input, answer: "school" }], [saved]);
    assert.equal(english.readings, undefined);
    assert.equal(english.reading_version, undefined);
});

test("technical compounds, katakana and kana normalization", async () => {
    for (const [word, reading] of Object.entries({
        オレンジ: "おれんじ", ミセルコロイド: "みせるころいど", エーロゾル: "えーろぞる",
        キセロゲル: "きせろげる", 林檎: "りんご", ｵﾚﾝｼﾞ: "おれんじ",
        分子コロイド: "ぶんしころいど", 分散コロイド: "ぶんさんころいど", 保護コロイド: "ほごころいど",
        塩析: "えんせき", 凝析: "ぎょうせき", 電気泳動: "でんきえいどう", ブラウン運動: "ぶらうんうんどう",
        チンダル現象: "ちんだるげんしょう", 懸濁液: "けんだくえき", 乳濁液: "にゅうだくえき",
    })) assert.deepEqual(await generateReadings(word), [reading]);
});

test("saving existing items retries empty, missing, stale and changed answers", async () => {
    const item: Item = { id: "a", type: "typed_recall", prompt: "問", answer: "塩析" };
    for (const old of [item, { ...item, readings: [], reading_version: 2 },
        { ...item, readings: ["しお"], reading_version: 1 },
        { ...item, answer: "塩", readings: ["しお"], reading_version: 2 }]) {
        const [saved] = await prepareItemReadings([item], [old]);
        assert.deepEqual(saved.readings, ["えんせき"]);
        assert.equal(saved.reading_version, 2);
    }
});

test("manual, CSV and large JSON imports share save-time generation", async () => {
    const pairs = Array.from({ length: 512 }, (_, i) => ({ jp: "問" + i, en: "分子コロイド" }));
    const json = JSON.stringify(Object.fromEntries(pairs.map(p => [p.jp, p.en])));
    // Use explicit Japanese question labels to keep the CSV orientation tied.
    const csv = "問,分子コロイド";
    for (const input of [pairs, parseImportedWords(json), parseImportedWords(csv)]) {
        const items = input.map(({ jp, en }, i): Item => ({
            id: String(i), type: "typed_recall", prompt: jp, answer: en,
        }));
        let calls = 0;
        const saved = await prepareItemReadings(items, [], async word => {
            calls++;
            return generateReadings(word);
        });
        assert.equal(saved.length, input === pairs || items.length > 1 ? 512 : 1);
        assert.equal(calls, 1);
        assert.ok(saved.every(i => i.reading_version === 2 && i.readings?.[0] === "ぶんしころいど"));
    }
});
