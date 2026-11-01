import { redirect } from "next/navigation";
import { getSignInUrl } from "@/lib/auth/sign-in-url";
import { getUserDetails } from "@/lib/auth/session";
import { getMyRooms, getPublicRooms } from "@/lib/room/get";
import { getSavedRoomIds } from "@/lib/room/save";
import RoomList from "./RoomList";

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ filter?: string; owner?: string }>;
}) {
    const { filter, owner } = await searchParams;

    const initialView =
        filter === "mine"
            ? "me"
            : filter === "public"
              ? "public"
              : owner === "me"
                ? "me"
                : "public";

    const [publicRooms, currentUser, savedRoomIds, myRoomsResult] =
        await Promise.all([
            getPublicRooms(),
            getUserDetails(),
            getSavedRoomIds(),
            getMyRooms(),
        ]);

    if (!currentUser && initialView === "me") {
        redirect(getSignInUrl());
    }

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
