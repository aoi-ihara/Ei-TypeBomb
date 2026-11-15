import { getPublicRooms } from "@/lib/room/get";
import RoomList from "../RoomList";

// Guest-only ISR page; authenticated requests are rewritten to dynamic SSR.
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
        />
    );
}
