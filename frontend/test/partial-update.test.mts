import assert from "node:assert/strict";
import { test } from "node:test";
import { validRoomUpdate } from "../lib/room/partial-update";

const word = (id: string, prompt = "猫", answer = "cat") => ({
    id, type: "typed_recall" as const, prompt, answer,
});

test("invalid settings do not block valid fields or mutate the draft", () => {
    const draft = { id: "room", title: "", explanation: "saved", link: "!",
        maxPlayers: NaN, gameDuration: 0, bombCount: 5, items: [word("good")] };
    assert.deepEqual(validRoomUpdate(draft), {
        id: "room", explanation: "saved", items: [word("good")],
    });
    assert.equal(draft.title, "");
    assert.equal(draft.items.length, 1);
});

test("skip only invalid words and duplicate IDs while keeping valid order", () => {
    assert.deepEqual(validRoomUpdate({ id: "room", items: [
        word("long", "a".repeat(1001)), word("blank", " "),
        word("empty-answer", "猫", " "), word(""),
        word("ok"), word("ok"), word("last", "犬", "dog"),
    ] }).items, [word("ok"), word("last", "犬", "dog")]);
});

test("retain at most 512 valid words, excluding invalid rows before counting", () => {
    const items = [word("bad", "a".repeat(1001)),
        ...Array.from({ length: 513 }, (_, i) => word(String(i)))];
    const saved = validRoomUpdate({ id: "room", items }).items!;
    assert.equal(saved.length, 512);
    assert.equal(saved[511].id, "511");
});

test("empty word lists save deletions and boundary values remain valid", () => {
    const draft = { id: "room", title: "a".repeat(64), explanation: "",
        maxPlayers: 4, bombCount: 4, gameDuration: 20, link: "valid", items: [] };
    assert.deepEqual(validRoomUpdate(draft), draft);
    assert.deepEqual(validRoomUpdate({ id: "room", items: [word("bad", "", "")] }).items, []);
});

test("preserve the stored list while an answer is over the new limit", () => {
    const items = [word("legacy", "猫", "a".repeat(101)), word("ok")];
    assert.deepEqual(validRoomUpdate({ id: "room", title: "updated", items }),
        { id: "room", title: "updated" });
});
