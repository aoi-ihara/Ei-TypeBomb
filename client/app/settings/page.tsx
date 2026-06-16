import { cookies } from "next/headers";
import Settings from "./Settings";

export default async function SettingsPage() {
    const cookieStore = await cookies();

    const backgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const sounDeffects = cookieStore.get("sound-effects")?.value !== "false";

    const serverUrl = cookieStore.get("server-url")?.value ?? "";

    return (
        <Settings
            initialSounDeffects={sounDeffects}
            initialBackgroundMusic={backgroundMusic}
            initialServerUrl={serverUrl}
        />
    );
}
