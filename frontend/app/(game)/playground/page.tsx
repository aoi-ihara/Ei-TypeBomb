import { redirect } from "next/navigation";
import { getPlaygroundRoom } from "@/lib/room/playground";

export default async function LegacyPlaygroundRoute() {
    const room = await getPlaygroundRoom();
    redirect(room ? "/" + room.id + "/offline" : "/");
}
