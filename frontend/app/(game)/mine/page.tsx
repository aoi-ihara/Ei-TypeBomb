import { redirect } from "next/navigation";
import { getSignInUrl } from "@/lib/auth/sign-in-url";
import { getRoomListData } from "../room-list-data";
import RoomList from "../RoomList";

export default async function Page() {
    const roomListData = await getRoomListData();

    if (!roomListData.currentUser) redirect(getSignInUrl());

    return <RoomList {...roomListData} initialView="mine" />;
}
