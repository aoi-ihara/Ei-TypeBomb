import { getRoomListData } from "../../room-list-data";
import RoomList from "../../RoomList";

// Rewritten from the public URL only when a Supabase session cookie exists.
// This page verifies the user on the server and must never be CDN-cached.
export const dynamic = "force-dynamic";

export const metadata = {
    robots: { index: false, follow: false },
};

export default async function Page() {
    const roomListData = await getRoomListData("latest");
    return <RoomList {...roomListData} initialView="latest" />;
}
