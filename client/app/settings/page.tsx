import { cookies } from "next/headers";
import Settings from "./Settings";

export default async function SettingsPage() {
    const cookieStore = await cookies();

    const backgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const soundEffect = cookieStore.get("sound-effect")?.value !== "false";

    const serverUrl = cookieStore.get("server-url")?.value ?? "";

    return (
        <Settings
            initialSoundEffect={soundEffect}
            initialBackgroundMusic={backgroundMusic}
            initialServerUrl={serverUrl}
        />
    );
}
