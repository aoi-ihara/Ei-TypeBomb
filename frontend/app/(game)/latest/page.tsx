import { getRoomListData } from "../room-list-data";
import RoomList from "../RoomList";

export default async function Page() {
    const roomListData = await getRoomListData();

    return <RoomList {...roomListData} initialView="latest" />;
}
