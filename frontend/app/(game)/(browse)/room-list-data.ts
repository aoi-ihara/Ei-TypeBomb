import { getUserDetails } from "@/lib/auth/session";
import { getPublicRooms } from "@/lib/room/get";
import { getOwnedRoomsForUser, getOwnedRoomIdsForUser, getSavedRoomIdsForUser } from "@/lib/room/list-queries";
import type { View } from "@/type";
import { cache } from "react";

export const getRoomListData = cache(async (view: View) => {
    // Mine needs no public feed; public feeds only need owner IDs for edit hints.
    const publicRoomsRequest = view === "mine" ? Promise.resolve([]) : getPublicRooms();
    const currentUser = await getUserDetails();
    const [publicRooms, myRooms, savedRoomIds] = await Promise.all([
        publicRoomsRequest,
        currentUser
            ? view === "mine" || view === "saved"
                ? getOwnedRoomsForUser(currentUser.id)
                : getOwnedRoomIdsForUser(currentUser.id)
            : Promise.resolve([]),
        currentUser ? getSavedRoomIdsForUser(currentUser.id) : Promise.resolve([]),
    ]);

    return {
        publicRooms,
        myRooms: myRooms ?? [],
        currentUser,
        initialSavedRoomIds: savedRoomIds,
    };
});
