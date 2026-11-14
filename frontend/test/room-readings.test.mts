import assert from "node:assert/strict";
import test from "node:test";
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
    assert.equal(saved.reading_version, 1);
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
    assert.equal(unknown.reading_version, 1);
    assert.deepEqual(unknown.readings, []);
    const [english] = await prepareItemReadings([{ ...input, answer: "school" }], [saved]);
    assert.equal(english.readings, undefined);
    assert.equal(english.reading_version, undefined);
});
