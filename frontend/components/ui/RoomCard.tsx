"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Room } from "@/type";
import { Icon } from "./Icon";
import Button from "./Button";
import posthog from "posthog-js";

export default function RoomCard({
    room,
    isOwner = false,
    isSaved = false,
    onToggleSaved,
}: {
    room: Room;
    isOwner?: boolean;
    isSaved?: boolean;
    onToggleSaved?: () => void;
}) {
    const router = useRouter();
    const [copied, setCopied] = useState(false);

    const copyRoomLink = async () => {
        try {
            const path = "/" + room.id;
            await navigator.clipboard.writeText(window.location.origin + path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
            posthog.capture("room_code_copied", { room_id: room.id });
        } catch (error) {
            console.error("Failed to copy room URL:", error);
        }
    };

    return (
        <article className="flex h-full min-w-0 w-full flex-col gap-4 rounded-lg bg-(--color-background-secondary) px-4 py-4">
            <div className="flex min-w-0 items-center gap-2">
                <Icon name={room.isPublic ? "earth" : "lock"} />
                <h2
                    className="min-w-0 flex-1 truncate font-bold"
                    data-cursor="text"
                >
                    {room.title || "無題のルーム"}
                </h2>
            </div>

            <p
                className={`line-clamp-2 w-full text-start ${!room.explanation && "italic opacity-50"}`}
                data-cursor="text"
            >
                {room.explanation || "説明なし"}
            </p>

            <div className="flex flex-wrap gap-4">
                <div className="flex items-end gap-2 opacity-50">
                    <Icon name="usersRound" />
                    <span
                        className="flex gap-1 items-center"
                        data-cursor="text"
                    >
                        <span className="text-sm">最大</span>
                        <span className="font-bold font-mono">
                            {room.maxPlayers ?? 2}
                        </span>
                        <span className="text-sm">人</span>
                    </span>
                </div>

                <div className="flex items-end gap-2 opacity-50">
                    <Icon name="playingCardsFan" />
                    <span
                        className="flex gap-1 items-center"
                        data-cursor="text"
                    >
                        <span className="font-bold font-mono">
                            {room.items?.length ?? 0}
                        </span>
                        <span className="text-sm">個の単語</span>
                    </span>
                </div>
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button
                    onClick={() => {
                        posthog.capture("play_clicked", { room_id: room.id });
                        router.push("/" + room.id);
                    }}
                    iconName="play"
                    variant="text"
                >
                    プレイ
                </Button>
                {isOwner && (
                    <Button
                        onClick={() => router.push("/" + room.id + "/edit")}
                        iconName="pen"
                        variant="text"
                    >
                        編集
                    </Button>
                )}
                <Button onClick={copyRoomLink} iconName="copy" variant="text">
                    {copied ? "コピー済み" : "リンクをコピー"}
                </Button>
                {onToggleSaved && (
                    <Button
                        onClick={onToggleSaved}
                        iconName={isSaved ? "check" : "bookmark"}
                        variant="text"
                    >
                        {isSaved ? "保存を解除" : "保存"}
                    </Button>
                )}
            </div>
        </article>
    );
}
