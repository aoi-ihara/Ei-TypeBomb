import { notFound, redirect } from "next/navigation";
import { getRoomRouteFromLink } from "@/lib/room/get";

export default async function JoinLegacyRoute({
    params,
}: {
    params: Promise<{ link: string }>;
}) {
    const { link } = await params;
    const route = await getRoomRouteFromLink(link);

    if (!route) notFound();
    redirect("/" + route.link);
}
