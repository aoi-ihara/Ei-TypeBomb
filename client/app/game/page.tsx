import Client from "./Client";
import { cookies } from "next/headers";

export default async function SettingsPage() {
    const cookieStore = await cookies();

    const backgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const soundEffect = cookieStore.get("sound-effect")?.value !== "false";

    const serverUrl = cookieStore.get("server-url")?.value ?? "";

    return (
        <Client
            initialSoundEffect={soundEffect}
            initialBackgroundMusic={backgroundMusic}
            initialServerUrl={serverUrl}
        />
    );
}
