import { redirect } from "next/navigation";
import { getPlaygroundRoom } from "@/lib/room/playground";

export default async function LegacyDisplayNameRoute() {
    const room = await getPlaygroundRoom();
    redirect(room ? "/" + (room.link ?? room.id) : "/");
}
