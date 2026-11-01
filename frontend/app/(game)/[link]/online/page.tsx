import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Client from "./Client";
import { parseETBClusterConfig } from "@/lib/room/clusterConfig";
import { getPlaygroundRoomRoute } from "@/lib/room/playground";

export default async function OnlinePlayPage({
    params,
}: {
    params: Promise<{ link: string }>;
}) {
    const { link } = await params;
    const room = await getPlaygroundRoomRoute();
    if (!room) redirect("/" + link);

    const canonicalLink = room.link ?? room.id;
    if (link !== canonicalLink) {
        if (link === room.id) redirect("/" + canonicalLink + "/online");
        redirect("/" + link);
    }

    const cookieStore = await cookies();
    const backgroundMusic =
        cookieStore.get("background-music")?.value !== "false";
    const soundEffects = cookieStore.get("sound-effects")?.value !== "false";
    const clusterServers = process.env.ETB_CLUSTER_CONFIG
        ? parseETBClusterConfig(process.env.ETB_CLUSTER_CONFIG).map(
              (server) => server.endpoint,
          )
        : [];

    return (
        <Client
            clusterServers={clusterServers}
            initialSounDeffects={soundEffects}
            initialBackgroundMusic={backgroundMusic}
        />
    );
}
