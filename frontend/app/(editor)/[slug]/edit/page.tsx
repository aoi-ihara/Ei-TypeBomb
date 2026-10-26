import { notFound } from "next/navigation";
import { getRoomFromId } from "@/lib/room/get";
import type { Room } from "@/type";
import EditorClient from "./EditorClient";

export default async function Page({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const room = await getRoomFromId(slug);

    if (!room) notFound();

    return <EditorClient key={slug} slug={slug} initialRoom={room} />;
}
