import { notFound } from "next/navigation";
import { getRoomListData } from "../../room-list-data";
import RoomList from "../../RoomList";
import type { View } from "@/type";

// Authenticated route target only. Never cache personalized HTML in the CDN.
// The proxy keeps / and /latest as the visible URLs.
export const dynamic = "force-dynamic";

export default async function AuthenticatedFeedPage({
    params,
}: {
    params: Promise<{ view: string }>;
}) {
    const { view } = await params;
    if (view !== "recommended" && view !== "latest") notFound();

    // Always recheck the actual Supabase user on the server. The proxy merely
    // selects this page when its session claim is valid.
    const data = await getRoomListData(view as View);
    return <RoomList {...data} initialView={view} />;
}
