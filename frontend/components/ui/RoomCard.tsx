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
            const path = room.isPublic ? "/" + room.id : "/" + room.id + "/play";
            await navigator.clipboard.writeText(window.location.origin + path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
            posthog.capture("room_code_copied", { room_id: room.id });
        } catch (error) {
            console.error("Failed to copy room URL:", error);
        }
    };

    return (
        <article className="flex h-full min-w-0 w-full flex-col gap-3 rounded-xl bg-(--color-background-secondary) px-4 py-4">
            <div className="flex min-w-0 items-center gap-2">
                <Icon name={room.isPublic ? "earth" : "lock"} />
                <h2 className="min-w-0 flex-1 truncate text-lg font-bold" data-cursor="text">
                    {room.title || "無題のルーム"}
                </h2>
            </div>

            <p className="line-clamp-2 min-h-10 w-full text-start text-sm opacity-80">
                {room.explanation || "説明はありません。"}
            </p>

            <div className="flex items-center gap-2 text-sm">
                <Icon name="usersRound" />
                <span className="font-mono font-bold">{room.maxPlayers ?? 2}</span>
                <span className="opacity-60">人まで</span>
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-(--color-border) pt-3">
                <Button
                    onClick={() => {
                        posthog.capture("play_clicked", { room_id: room.id });
                        router.push("/" + room.id + "/play");
                    }}
                    iconName="play"
                    variant="text"
                >
                    プレイ
                </Button>
                <Button
                    onClick={() => router.push("/" + room.id)}
                    iconName="info"
                    variant="text"
                >
                    詳細
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
