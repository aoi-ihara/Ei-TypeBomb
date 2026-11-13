import { notFound, redirect } from "next/navigation";
import { getRoomForEditFromLink } from "@/lib/room/get";
import EditorClient from "./EditorClient";

export default async function Page({
    params,
}: {
    params: Promise<{ link: string }>;
}) {
    const { link } = await params;
    const room = await getRoomForEditFromLink(link);
    if (!room) notFound();
    const canonicalLink = room.link ?? room.id;
    if (link !== canonicalLink) redirect("/" + canonicalLink + "/edit");

    return (
        <EditorClient key={canonicalLink} link={canonicalLink} initialRoom={room} />
    );
}
