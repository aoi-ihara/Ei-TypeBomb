import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Client from "./Client";
import { parseETBClusterConfig } from "@/lib/room/clusterConfig";
import { getPlaygroundRoom } from "@/lib/room/playground";

export default async function OnlinePlayPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const room = await getPlaygroundRoom();
    if (!room || room.id !== slug) redirect("/" + slug + "/play");

    const cookieStore = await cookies();
    const backgroundMusic = cookieStore.get("background-music")?.value !== "false";
    const sounDeffects = cookieStore.get("sound-effects")?.value !== "false";
    const clusterServers = process.env.ETB_CLUSTER_CONFIG
        ? parseETBClusterConfig(process.env.ETB_CLUSTER_CONFIG).map((server) => server.endpoint)
        : [];

    return (
        <Client
            clusterServers={clusterServers}
            initialSounDeffects={sounDeffects}
            initialBackgroundMusic={backgroundMusic}
        />
    );
}
