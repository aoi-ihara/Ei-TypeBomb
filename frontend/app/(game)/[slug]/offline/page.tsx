import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Client from "./Client";
import { getPlaygroundRoom } from "@/lib/room/playground";
import { parseOfflineVoiceReading } from "@/lib/settings";

export default async function OfflinePlayPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const [cookieStore, room] = await Promise.all([
        cookies(),
        getPlaygroundRoom(),
    ]);

    if (!room || room.id !== slug) redirect("/" + slug);

    const backgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const soundEffects = cookieStore.get("sound-effects")?.value !== "false";
    const offlineVoiceReading = parseOfflineVoiceReading(
        cookieStore.get("offline-voice-reading")?.value,
    );

    return (
        <Client
            room={room}
            initialSounDeffects={soundEffects}
            initialBackgroundMusic={backgroundMusic}
            initialOfflineVoiceReading={offlineVoiceReading}
        />
    );
}
