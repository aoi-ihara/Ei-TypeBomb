"use client";

import type { ReactNode } from "react";
import Shell from "@/components/layout/Shell";
import { useRoomListBackHref } from "../RoomBrowser";

export default function RoomDetailShell({ title, roomId, children }: { title: string; roomId: string; children: ReactNode }) {
    const backHref = useRoomListBackHref();

    return (
        <Shell
            showHeader={false}
            title={title}
            className="grid lg:grid-cols-2 gap-4 px-4"
            back={backHref}
            size="xlarge"
            morphTarget={roomId}
        >
            {children}
        </Shell>
    );
}
