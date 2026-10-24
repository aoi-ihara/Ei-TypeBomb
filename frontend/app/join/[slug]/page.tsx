import { notFound, redirect } from "next/navigation";
import isUUID from "validator/es/lib/isUUID";
import { getRoomFromLink } from "@/lib/room/get";

export default async function JoinLegacyRoute({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;

    // A custom invite slug can itself look like a UUID. Resolve the unique
    // custom link first; only fall back to treating the slug as a room ID.
    const roomId = (await getRoomFromLink(slug)) ??
        (isUUID(slug, 4) ? slug : null);

    if (!roomId) notFound();
    redirect("/" + roomId + "/play");
}
