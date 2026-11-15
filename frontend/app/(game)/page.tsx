import { getPublicRooms } from "@/lib/room/get";
import RoomList from "./RoomList";

// Share the public feed HTML across visitors. A separate server-rendered route handles signed-in viewers.
export const dynamic = "force-static";
export const revalidate = 3600;

export default async function Page() {
    const publicRooms = await getPublicRooms({ failOnError: true });

    return (
        <RoomList
            publicRooms={publicRooms}
            myRooms={[]}
            initialSavedRoomIds={[]}
            currentUser={null}
            initialView="recommended"
        />
    );
}
