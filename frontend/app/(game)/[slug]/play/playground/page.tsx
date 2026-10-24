import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Client from "./Client";
import { getPlaygroundRoom } from "@/lib/room/playground";

export default async function PlaygroundPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const [cookieStore, room] = await Promise.all([
        cookies(),
        getPlaygroundRoom(),
    ]);

    if (!room || room.id !== slug) redirect("/" + slug + "/play");

    const backgroundMusic = cookieStore.get("background-music")?.value !== "false";
    const sounDeffects = cookieStore.get("sound-effects")?.value !== "false";

    return (
        <Client
            room={room}
            initialSounDeffects={sounDeffects}
            initialBackgroundMusic={backgroundMusic}
        />
    );
}
