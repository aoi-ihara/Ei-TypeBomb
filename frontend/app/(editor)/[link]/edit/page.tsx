import { notFound, redirect } from "next/navigation";
import { getRoomFromId, getRoomRouteFromLink } from "@/lib/room/get";
import type { Room } from "@/type";
import EditorClient from "./EditorClient";

export default async function Page({
    params,
}: {
    params: Promise<{ link: string }>;
}) {
    const { link } = await params;
    const route = await getRoomRouteFromLink(link);
    if (!route) notFound();
    if (link !== route.link) redirect("/" + route.link + "/edit");

    const room = await getRoomFromId(route.id);

    if (!room) notFound();

    return <EditorClient key={route.link} link={route.link} initialRoom={room} />;
}
