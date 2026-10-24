import { notFound, redirect } from "next/navigation";
import isUUID from "validator/es/lib/isUUID";
import { getRoomFromLink } from "@/lib/room/get";

export default async function JoinLegacyRoute({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const roomId = isUUID(slug, 4) ? slug : await getRoomFromLink(slug);
    if (!roomId) notFound();
    redirect("/" + roomId);
}
