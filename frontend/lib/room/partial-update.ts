import type { Room, Item } from "../../type";
import {
    validateTitle,
    validateExplanation,
    validateMaxPlayers,
    validateGameDuration,
    validateLink,
    validateItems,
} from "../auth/validator";

/** Drop invalid editor fields without changing the caller's draft. */
export function validRoomUpdate(room: Room): Room {
    const valid = { ...room };
    if (validateTitle(room.title)) delete valid.title;
    if (validateExplanation(room.explanation)) delete valid.explanation;
    if (
        room.maxPlayers !== undefined &&
        (!Number.isInteger(room.maxPlayers) ||
            validateMaxPlayers(room.maxPlayers))
    ) {
        delete valid.maxPlayers;
    }
    if (
        room.gameDuration !== undefined &&
        validateGameDuration(room.gameDuration)
    ) {
        delete valid.gameDuration;
    }
    if (validateLink(room.link)) delete valid.link;
    if (
        room.bombCount !== undefined &&
        room.bombCount !== null &&
        (!Number.isInteger(room.bombCount) ||
            room.bombCount < 1 ||
            room.bombCount > 4 ||
            (valid.maxPlayers !== undefined &&
                room.bombCount > valid.maxPlayers))
    ) {
        delete valid.bombCount;
    }
    if (room.items !== undefined) {
        const ids = new Set<string>();
        const items: Item[] = [];
        for (const item of room.items) {
            if (items.length === 512) break;
            if (
                ids.has(item.id) ||
                !item.prompt.trim() ||
                validateItems([item])
            )
                continue;
            ids.add(item.id);
            items.push(item);
        }
        valid.items = items;
    }
    return valid;
}
