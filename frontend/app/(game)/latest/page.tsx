import { getPublicRooms } from "@/lib/room/get";
import RoomList from "../RoomList";

// The latest view shares the public feed's ISR data, but sorts it on the
// client without requesting account data during prerendering.
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
            initialView="latest"
            deferViewer
        />
    );
}
