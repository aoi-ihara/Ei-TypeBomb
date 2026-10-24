import { notFound } from "next/navigation";
import { getPlaygroundRoom } from "@/lib/room/playground";
import { getRoomSummaryFromId } from "@/lib/room/get";
import PlayRoom from "./PlayRoom";

export default async function PlayPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const [summary, authorizedRoom] = await Promise.all([
        getRoomSummaryFromId(slug),
        getPlaygroundRoom(),
    ]);
    if (!summary) notFound();

    return (
        <PlayRoom
            roomId={slug}
            title={summary.room.title || "ルーム"}
            alreadyAuthorized={authorizedRoom?.id === slug}
            itemCount={summary.itemCount}
        />
    );
}
