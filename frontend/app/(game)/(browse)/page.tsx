import { getPublicRooms } from "@/lib/room/get";
import RoomList from "./RoomList";

// Share the public feed HTML across visitors. Account-specific controls load
// from a separate private endpoint after hydration.
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
            deferViewer
        />
    );
}
