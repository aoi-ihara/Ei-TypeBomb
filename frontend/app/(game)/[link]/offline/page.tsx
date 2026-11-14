import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Client from "./Client";
import { getPlaygroundRoom } from "@/lib/room/playground";
import { parseOfflineVoiceReading } from "@/lib/settings";
import { getTypingAnswer, normalizeAnswerMode } from "@/lib/answer-mode";

export default async function OfflinePlayPage({
    params,
    searchParams,
}: {
    params: Promise<{ link: string }>;
    searchParams: Promise<{
        answerMode?: string | string[];
        [key: string]: string | string[] | undefined;
    }>;
}) {
    const [{ link }, query] = await Promise.all([params, searchParams]);
    const [cookieStore, room] = await Promise.all([
        cookies(),
        getPlaygroundRoom(),
    ]);

    if (!room) redirect("/" + link);

    const answerMode = normalizeAnswerMode(
        query.answerMode,
        room.items?.some(getTypingAnswer) ?? false,
    );
    const canonicalLink = room.link ?? room.id;
    if (link !== canonicalLink) {
        if (link === room.id)
            redirect("/" + canonicalLink + "/offline?answerMode=" + answerMode);
        redirect("/" + link);
    }

    const backgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const soundEffects = cookieStore.get("sound-effects")?.value !== "false";
    const offlineVoiceReading = parseOfflineVoiceReading(
        cookieStore.get("offline-voice-reading")?.value,
    );

    return (
        <Client
            room={room}
            answerMode={answerMode}
            initialSounDeffects={soundEffects}
            initialBackgroundMusic={backgroundMusic}
            initialOfflineVoiceReading={offlineVoiceReading}
        />
    );
}
