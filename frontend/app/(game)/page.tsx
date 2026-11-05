import { redirect } from "next/navigation";
import { getRoomListData } from "./room-list-data";
import RoomList from "./RoomList";

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ filter?: string; owner?: string }>;
}) {
    const { filter, owner } = await searchParams;

    // Keep previously shared category URLs working while using canonical routes.
    if (filter === "mine" || owner === "me") redirect("/mini");
    if (filter === "saved") redirect("/saved");

    const roomListData = await getRoomListData();

    return <RoomList {...roomListData} initialView="recommended" />;
}
