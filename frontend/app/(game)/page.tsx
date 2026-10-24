import { cookies } from "next/headers";
import { getUserDetails } from "@/lib/auth/session";
import { getMyRooms, getPublicRooms } from "@/lib/room/get";
import RoomList from "./RoomList";

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ owner?: string }>;
}) {
    const [{ owner }, cookieStore] = await Promise.all([
        searchParams,
        cookies(),
    ]);
    const initialBackgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const initialSoundEffects =
        cookieStore.get("sound-effects")?.value !== "false";

    if (owner === "me") {
        const [result, currentUser] = await Promise.all([
            getMyRooms(),
            getUserDetails(),
        ]);
        return (
            <RoomList
                rooms={result?.rooms ?? []}
                view="me"
                currentUser={currentUser}
                initialBackgroundMusic={initialBackgroundMusic}
                initialSoundEffects={initialSoundEffects}
            />
        );
    }

    const [rooms, currentUser] = await Promise.all([
        getPublicRooms(),
        getUserDetails(),
    ]);

    return (
        <RoomList
            rooms={rooms}
            view="public"
            currentUser={currentUser}
            initialBackgroundMusic={initialBackgroundMusic}
            initialSoundEffects={initialSoundEffects}
        />
    );
}
