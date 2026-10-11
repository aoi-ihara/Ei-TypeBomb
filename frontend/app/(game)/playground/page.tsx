import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Client from "./Client";
import { getPlaygroundRoom } from "@/lib/room/playground";
import { getUser } from "@/lib/auth/session";

export default async function PlaygroundPage() {
    const userId = await getUser();
    if (!userId) redirect(process.env.NEXT_PUBLIC_SIGN_IN_URL!);

    const [cookieStore, room] = await Promise.all([
        cookies(),
        getPlaygroundRoom(),
    ]);

    if (!room) redirect("/room");

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
