import { cookies } from "next/headers";
import { getUserDetails } from "@/lib/auth/session";
import { getMyRooms, getPublicRooms } from "@/lib/room/get";
import { getSavedRoomIds } from "@/lib/room/save";
import RoomList from "./RoomList";

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ filter?: string; owner?: string }>;
}) {
    const [{ filter, owner }] = await Promise.all([searchParams, cookies()]);

    const initialView =
        filter === "mine"
            ? "me"
            : filter === "public"
              ? "public"
              : owner === "me"
                ? "me"
                : "public";

    const [publicRooms, currentUser, savedRoomIds] = await Promise.all([
        getPublicRooms(),
        getUserDetails(),
        getSavedRoomIds(),
    ]);

    const myRoomsResult =
        currentUser || initialView === "me" ? await getMyRooms() : null;

    return (
        <RoomList
            publicRooms={publicRooms}
            myRooms={myRoomsResult?.rooms ?? []}
            initialView={initialView}
            currentUser={currentUser}
            initialSavedRoomIds={savedRoomIds}
        />
    );
}
