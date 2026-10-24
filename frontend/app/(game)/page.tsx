import { getUser } from "@/lib/auth/session";
import { getMyRooms, getPublicRooms } from "@/lib/room/get";
import RoomList from "./RoomList";

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ owner?: string }>;
}) {
    const { owner } = await searchParams;

    if (owner === "me") {
        const result = await getMyRooms();
        return (
            <RoomList
                rooms={result?.rooms ?? []}
                view="me"
                isSignedIn={true}
            />
        );
    }

    const [rooms, userId] = await Promise.all([getPublicRooms(), getUser()]);

    return (
        <RoomList
            rooms={rooms}
            view="public"
            isSignedIn={Boolean(userId)}
        />
    );
}
