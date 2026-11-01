import { redirect } from "next/navigation";
import { getPlaygroundRoom } from "@/lib/room/playground";

export default async function LegacyOnlineRoute() {
    const room = await getPlaygroundRoom();
    redirect(room ? "/" + room.id + "/online" : "/");
}
