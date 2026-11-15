import { getRoomListData } from "../room-list-data";
import RoomList from "../RoomList";

// Public room data is fetched from Upstash/Supabase at request time.
export const dynamic = "force-dynamic";

export default async function Page() {
    const roomListData = await getRoomListData();

    return <RoomList {...roomListData} initialView="latest" />;
}
