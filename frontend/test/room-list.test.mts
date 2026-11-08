import assert from "node:assert/strict";
import { test } from "node:test";
import type { Room } from "../type/index";
import { selectRoomsForView } from "../lib/room/list-view";

const otherPublic: Room = {
    id: "public-other",
    title: "Other's public room",
    visibility: "public",
    updatedAt: "2026-11-02T00:00:00Z",
};
const myPublic: Room = {
    id: "public-mine",
    title: "My public room",
    visibility: "public",
    updatedAt: "2026-11-01T00:00:00Z",
};
const myPrivate: Room = {
    id: "private-mine",
    title: "My private room",
    visibility: "private",
    updatedAt: "2026-11-03T00:00:00Z",
};
const otherUnlisted: Room = {
    id: "unlisted-other",
    title: "Other's unlisted room",
    visibility: "unlisted",
};

function select(view: "recommended" | "mine" | "saved") {
    return selectRoomsForView({
        view,
        publicRooms: [otherPublic, myPublic, otherUnlisted],
        myRooms: [myPublic, myPrivate],
        savedRoomIds: ["public-other", "private-mine", "unlisted-other"],
        currentUserId: "authenticated-user",
    });
}

test("recommended preserves public ranking and does not reveal private or unlisted rooms", () => {
    assert.deepEqual(select("recommended").map(({ id }) => id), [
        "public-other",
        "public-mine",
    ]);
});

test("mine includes all owned visibility levels, newest first", () => {
    assert.deepEqual(select("mine").map(({ id }) => id), [
        "private-mine",
        "public-mine",
    ]);
});

test("saved applies the same visibility boundary as the web room feed", () => {
    assert.deepEqual(select("saved").map(({ id }) => id), [
        "public-other",
        "private-mine",
    ]);
});

test("own version of a room overrides public summary and retains ownership", () => {
    const result = selectRoomsForView({
        view: "recommended",
        publicRooms: [myPublic],
        myRooms: [{ ...myPublic, title: "Edited", userId: undefined }],
        savedRoomIds: [],
        currentUserId: "authenticated-user",
    });
    assert.equal(result[0].title, "Edited");
    assert.equal(result[0].userId, "authenticated-user");
});

test("guest never gains access from saved IDs alone", () => {
    const result = selectRoomsForView({
        view: "saved",
        publicRooms: [otherPublic],
        myRooms: [],
        savedRoomIds: ["private-mine", "public-other"],
        currentUserId: null,
    });
    assert.deepEqual(result.map(({ id }) => id), ["public-other"]);
});
