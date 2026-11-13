import assert from "node:assert/strict";
import { test } from "node:test";
import type { Room } from "../type/index";
import {
    rebaseEditorSnapshot,
    sameEditorSnapshot,
    snapshotFromRoom,
} from "../lib/room/editor-rebase";

const initial: Room = {
    id: "room-1",
    title: "Original",
    explanation: "Description",
    maxPlayers: 2,
    gameDuration: 20,
    bombCount: null,
    link: "original",
    items: [{ id: "item-1", type: "typed_recall", prompt: "猫", answer: "cat" }],
};

test("browser back without unsaved edits adopts latest room values", () => {
    const base = snapshotFromRoom(initial);
    const latest = snapshotFromRoom({ ...initial, title: "Updated", link: "new-link" });
    assert.deepEqual(rebaseEditorSnapshot(base, base, latest), latest);
    assert.equal(sameEditorSnapshot(base, latest), false);
});

test("fresh remote fields are adopted without losing unrelated local edits", () => {
    const base = snapshotFromRoom(initial);
    const local = { ...base, roomExplanation: "My draft" };
    const latest = snapshotFromRoom({ ...initial, title: "Changed elsewhere" });
    assert.deepEqual(rebaseEditorSnapshot(base, local, latest), {
        ...latest,
        roomExplanation: "My draft",
    });
});

test("same-field edits never silently overwrite the remote version", () => {
    const base = snapshotFromRoom(initial);
    const local = { ...base, roomTitle: "Local draft" };
    const latest = snapshotFromRoom({ ...initial, title: "Remote edit" });
    assert.equal(rebaseEditorSnapshot(base, local, latest), null);
});

test("concurrent item edits never overwrite each other", () => {
    const base = snapshotFromRoom(initial);
    const local = { ...base, items: [...(base.items ?? []), {
        id: "item-2",
        type: "typed_recall" as const,
        prompt: "犬",
        answer: "dog",
    }] };
    const remote = snapshotFromRoom({
        ...initial,
        items: [{ id: "item-1", type: "typed_recall", prompt: "猫", answer: "kitty" }],
    });
    assert.equal(rebaseEditorSnapshot(base, local, remote), null);
});

test("unchanged values and divergent room identities are handled explicitly", () => {
    const base = snapshotFromRoom(initial);
    assert.equal(sameEditorSnapshot(base, { ...base }), true);
    assert.equal(rebaseEditorSnapshot(base, base, { ...base, roomId: "other" }), null);
});

test("equivalent snapshots compare equal regardless of insertion order", () => {
    const base = snapshotFromRoom(initial);
    const reordered = {
        roomTitle: base.roomTitle,
        roomExplanation: base.roomExplanation,
        maxPlayers: base.maxPlayers,
        gameDuration: base.gameDuration,
        bombCount: base.bombCount,
        items: base.items,
        roomId: base.roomId,
        roomLink: base.roomLink,
    };
    assert.equal(sameEditorSnapshot(base, reordered), true);
    assert.equal(sameEditorSnapshot(reordered, base), true);
});
