"use client";

import { useEffect, useMemo, useState } from "react";
import { io } from "@/lib/room/socket";
import { getAuthToken } from "@/lib/room/auth";
import type { Item, LegacyWord } from "@/type";
import { legacyWireWordsToItems } from "@/lib/item";

type RoomSnapshot = {
    users: { id: string; displayName?: string }[];
    isStart: boolean;
    bombHolder: number;
    wordIndex?: number;
    items?: Item[];
    words?: LegacyWord[];
};

export default function TypingSyncOverlay({
    serverUrl,
}: {
    serverUrl: string;
}) {
    const [currentInput, setCurrentInput] = useState("");
    const [room, setRoom] = useState<RoomSnapshot | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        const socket = io(
            serverUrl || process.env.NEXT_PUBLIC_RENDER_URL || "",
        );

        socket.on("auth:request", async () => {
            setUserId(socket.id ?? null);
            const jwtToken = await getAuthToken();
            if (!jwtToken) return;

            socket.emit("auth:response", {
                jwtToken,
                displayName: localStorage.getItem("display-name") ?? "",
            });
        });

        socket.on("room:broadcast", (nextRoom: RoomSnapshot) => {
            setRoom(nextRoom);
            if (!nextRoom.isStart || nextRoom.wordIndex === undefined) {
                setCurrentInput("");
            }
        });

        socket.on("typing:input", ({ input }: { input: string }) => {
            setCurrentInput(input);
        });

        return () => {
            socket.disconnect();
        };
    }, [serverUrl]);

    const currentUser = useMemo(() => room?.users?.[room.bombHolder], [room]);

    const currentItem = useMemo(() => {
        if (!room || room.wordIndex === undefined) return null;
        const items = room.items ?? legacyWireWordsToItems(room.words);
        return items[room.wordIndex] ?? null;
    }, [room]);

    const shouldShow = Boolean(
        room?.isStart &&
        currentItem?.type === "typed_recall" &&
        currentItem.answer &&
        currentUser?.id &&
        currentUser.id !== userId &&
        currentInput,
    );

    if (!shouldShow || currentItem?.type !== "typed_recall") return null;

    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 md:left-1/2 md:w-1/2 md:translate-x-0">
            <div className="w-fit max-w-full rounded-lg border border-(--color-border) bg-(--color-background-secondary) p-1 shadow-sm">
                <div className="flex flex-wrap gap-y-3">
                    {[...currentItem.answer].map((char, index) => (
                        <div
                            key={`${char}-${index}`}
                            className={`${char === " " ? "w-4" : "w-8"} h-16 p-1 font-mono text-3xl font-bold`}
                        >
                            <div className="flex h-full w-full items-center justify-center border-b border-(--color-border)">
                                {currentInput[index] ?? ""}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
