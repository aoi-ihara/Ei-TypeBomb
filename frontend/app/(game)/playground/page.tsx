import { redirect } from "next/navigation";
import { getPlaygroundRoomRoute } from "@/lib/room/playground";

export default async function LegacyPlaygroundRoute() {
    const room = await getPlaygroundRoomRoute();
    redirect(room ? "/" + (room.link ?? room.id) + "/offline" : "/");
}
