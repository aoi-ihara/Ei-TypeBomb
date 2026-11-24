"use client";

import { useEffect } from "react";
import { useRoomListViewer } from "@/components/rooms/RoomListViewerProvider";

export default function RoomViewerHint({ signedIn }: { signedIn: boolean }) {
    const { setSignedInHint } = useRoomListViewer();
    useEffect(() => setSignedInHint(signedIn), [signedIn, setSignedInHint]);
    return null;
}
