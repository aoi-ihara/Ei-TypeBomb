import { NextResponse } from "next/server";
import { getUserDetails } from "@/lib/auth/session";
import {
    getOwnedRoomIdsForUser,
    getSavedRoomIdsForUser,
} from "@/lib/room/list-queries";

// Every response contains viewer-specific state. It must never enter the CDN,
// browser HTTP cache, or a shared Next.js data cache.
export const dynamic = "force-dynamic";

const headers = {
    "Cache-Control": "private, no-store, max-age=0",
};

export async function GET() {
    try {
        const currentUser = await getUserDetails();
        if (!currentUser) {
            return NextResponse.json(
                { currentUser: null, ownedRoomIds: [], savedRoomIds: [] },
                { headers },
            );
        }

        const [ownedRooms, savedRoomIds] = await Promise.all([
            getOwnedRoomIdsForUser(currentUser.id),
            getSavedRoomIdsForUser(currentUser.id),
        ]);

        // A transient DB failure must not be mistaken for a guest session.
        if (!ownedRooms || !savedRoomIds) {
            return NextResponse.json(
                { error: "Viewer information is temporarily unavailable" },
                { status: 503, headers },
            );
        }

        return NextResponse.json(
            {
                currentUser,
                ownedRoomIds: ownedRooms.map((room) => room.id),
                savedRoomIds,
            },
            { headers },
        );
    } catch (error) {
        console.error("Failed to load public feed viewer state", error);
        return NextResponse.json(
            { error: "Viewer information is temporarily unavailable" },
            { status: 503, headers },
        );
    }
}
