import "server-only";

import { getPublicRooms } from "./get";
import { getOwnedRoomsForUser, getSavedRoomIdsForUser } from "./list-queries";

/**
 * Source of truth for the three room-list views (web and MCP).
 * A browser session supplies its validated user ID; MCP supplies the ID from
 * the verified access token. Neither path accepts a user ID from the client.
 */
export const getRoomCollectionsForUser = async (
    userId: string | null,
    { strict = false }: { strict?: boolean } = {},
) => {
    const [publicRooms, ownedRooms, savedRoomIds] = await Promise.all([
        getPublicRooms(),
        userId ? getOwnedRoomsForUser(userId) : Promise.resolve([]),
        userId ? getSavedRoomIdsForUser(userId) : Promise.resolve([]),
    ]);

    if (strict && (ownedRooms === null || savedRoomIds === null)) {
        throw new Error("Failed to load authenticated room lists");
    }

    return {
        publicRooms,
        myRooms: ownedRooms ?? [],
        savedRoomIds: savedRoomIds ?? [],
    };
};
