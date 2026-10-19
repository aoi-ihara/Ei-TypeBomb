import Client from "./Client";
import { cookies } from "next/headers";
import { parseETBClusterConfig } from "../../../../backend/shared/clusterConfig";

export default async function SettingsPage() {
    const cookieStore = await cookies();

    const backgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const sounDeffects = cookieStore.get("sound-effects")?.value !== "false";

    const clusterServers = process.env.ETB_CLUSTER_CONFIG
        ? parseETBClusterConfig(process.env.ETB_CLUSTER_CONFIG).map(s => s.endpoint)
        : [];
    return (
        <Client clusterServers={clusterServers}
            initialSounDeffects={sounDeffects}
            initialBackgroundMusic={backgroundMusic}
        />
    );
}
