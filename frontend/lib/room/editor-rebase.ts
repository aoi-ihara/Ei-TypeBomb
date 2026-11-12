import type { Room, TypedRecallItem } from "../../type";

export type EditorSnapshot = {
    roomId: string;
    roomTitle: string;
    roomExplanation: string;
    maxPlayers: string;
    gameDuration: number;
    bombCount: number | null;
    items: TypedRecallItem[] | null;
    roomLink: string;
};

const EDITABLE_FIELDS = [
    "roomTitle",
    "roomExplanation",
    "maxPlayers",
    "gameDuration",
    "bombCount",
    "items",
    "roomLink",
] as const;

export function snapshotFromRoom(room: Room): EditorSnapshot {
    return {
        roomId: room.id,
        roomTitle: room.title ?? "",
        roomExplanation: room.explanation ?? "",
        maxPlayers: String(room.maxPlayers ?? 2),
        gameDuration: room.gameDuration ?? 20,
        bombCount: room.bombCount ?? null,
        items: room.items ?? [],
        roomLink: room.link ?? room.id,
    };
}

export function sameEditorSnapshot(
    first: EditorSnapshot,
    second: EditorSnapshot,
): boolean {
    return JSON.stringify(first) === JSON.stringify(second);
}

/**
 * Keep unsaved local changes while adopting fresh values for untouched fields.
 * Never auto-merge when both sides edited the same field differently.
 */
export function rebaseEditorSnapshot(
    base: EditorSnapshot,
    local: EditorSnapshot,
    latest: EditorSnapshot,
): EditorSnapshot | null {
    if (base.roomId !== local.roomId || base.roomId !== latest.roomId) {
        return null;
    }

    const rebased = { ...latest };
    for (const key of EDITABLE_FIELDS) {
        if (JSON.stringify(local[key]) === JSON.stringify(base[key])) continue;

        if (
            JSON.stringify(latest[key]) !== JSON.stringify(base[key]) &&
            JSON.stringify(latest[key]) !== JSON.stringify(local[key])
        ) {
            return null;
        }

        Object.assign(rebased, { [key]: local[key] });
    }

    return rebased;
}
