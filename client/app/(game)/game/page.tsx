import Client from "./Client";
import { cookies } from "next/headers";

export default async function SettingsPage() {
    const cookieStore = await cookies();

    const backgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const sounDeffects = cookieStore.get("sound-effects")?.value !== "false";

    const serverUrl = cookieStore.get("server-url")?.value ?? "";

    return (
        <Client
            initialSounDeffects={sounDeffects}
            initialBackgroundMusic={backgroundMusic}
            initialServerUrl={serverUrl}
        />
    );
}
