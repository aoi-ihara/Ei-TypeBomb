import { cookies } from "next/headers";
import { getUserDetails } from "@/lib/auth/session";
import { getMyRooms, getPublicRooms } from "@/lib/room/get";
import RoomList from "./RoomList";

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ filter?: string; owner?: string }>;
}) {
    const [{ filter, owner }, cookieStore] = await Promise.all([
        searchParams,
        cookies(),
    ]);
    const initialBackgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const initialSoundEffects =
        cookieStore.get("sound-effects")?.value !== "false";

    // Query filters initialize the list when arriving from another page.
    // Keep supporting the old owner=me URL for existing bookmarks.
    const initialView =
        filter === "mine"
            ? "me"
            : filter === "public"
              ? "public"
              : owner === "me"
                ? "me"
                : "public";

    const [publicRooms, currentUser] = await Promise.all([
        getPublicRooms(),
        getUserDetails(),
    ]);

    // Load owned rooms on the server so switching tabs on this page does not
    // require a route transition or another request.
    const myRoomsResult =
        currentUser || initialView === "me" ? await getMyRooms() : null;

    return (
        <RoomList
            publicRooms={publicRooms}
            myRooms={myRoomsResult?.rooms ?? []}
            initialView={initialView}
            currentUser={currentUser}
            initialBackgroundMusic={initialBackgroundMusic}
            initialSoundEffects={initialSoundEffects}
        />
    );
}
