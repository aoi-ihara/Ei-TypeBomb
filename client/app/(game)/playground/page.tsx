import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Client from "./Client";
import { getPlaygroundRoom } from "@/lib/room/playground";

export default async function PlaygroundPage() {
    const room = await getPlaygroundRoom();
    if (!room) redirect("/room");

    const cookieStore = await cookies();
    const backgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const sounDeffects = cookieStore.get("sound-effects")?.value !== "false";

    return (
        <Client
            room={room}
            initialSounDeffects={sounDeffects}
            initialBackgroundMusic={backgroundMusic}
        />
    );
}
