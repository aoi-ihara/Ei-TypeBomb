import { getUserDetails } from "@/lib/auth/session";
import { getPublicRooms } from "@/lib/room/get";
import { getOwnedRoomsForUser, getSavedRoomIdsForUser } from "@/lib/room/list-queries";
import { cache } from "react";

export const getRoomListData = cache(async () => {
    const publicRoomsRequest = getPublicRooms();
    const currentUser = await getUserDetails();
    const [publicRooms, myRooms, savedRoomIds] = await Promise.all([
        publicRoomsRequest,
        currentUser ? getOwnedRoomsForUser(currentUser.id) : Promise.resolve([]),
        currentUser ? getSavedRoomIdsForUser(currentUser.id) : Promise.resolve([]),
    ]);

    return {
        publicRooms,
        myRooms: myRooms ?? [],
        currentUser,
        initialSavedRoomIds: savedRoomIds ?? [],
    };
});
