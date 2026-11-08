import { getUserDetails } from "@/lib/auth/session";
import { getRoomCollectionsForUser } from "@/lib/room/list-data";

export const getRoomListData = async () => {
    const currentUser = await getUserDetails();
    const { publicRooms, myRooms, savedRoomIds } =
        await getRoomCollectionsForUser(currentUser?.id ?? null);

    return {
        publicRooms,
        myRooms,
        currentUser,
        initialSavedRoomIds: savedRoomIds,
    };
};
