import { getRoomListData } from "../../room-list-data";
import RoomList from "../../RoomList";

// Authenticated requests must never render the shared ISR guest artifact.
export const dynamic = "force-dynamic";

export default async function Page() {
    const roomListData = await getRoomListData("latest");
    return <RoomList {...roomListData} initialView="latest" />;
}
