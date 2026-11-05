import { getUserDetails } from "@/lib/auth/session";
import { getMyRooms, getPublicRooms } from "@/lib/room/get";
import { getSavedRoomIds } from "@/lib/room/save";

export const getRoomListData = async () => {
    const [publicRooms, currentUser, initialSavedRoomIds, myRoomsResult] =
        await Promise.all([
            getPublicRooms(),
            getUserDetails(),
            getSavedRoomIds(),
            getMyRooms(),
        ]);

    return {
        publicRooms,
        myRooms: myRoomsResult?.rooms ?? [],
        currentUser,
        initialSavedRoomIds,
    };
};
