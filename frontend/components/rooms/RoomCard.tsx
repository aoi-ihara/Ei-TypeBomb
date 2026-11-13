"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import type { Room } from "@/type";
import { Icon } from "@/components/ui/Icon";
import Button from "@/components/ui/Button";
import posthog from "posthog-js";
import Link from "next/link";

export default function RoomCard({
    room,
    isOwner = false,
    isSaved = false,
    onToggleSaved,
    eagerPrefetch = false,
}: {
    room: Room;
    isOwner?: boolean;
    isSaved?: boolean;
    onToggleSaved?: () => void;
    eagerPrefetch?: boolean;
}) {
    const router = useRouter();
    const hoveredPrefetchRef = useRef(false);
    const [copied, setCopied] = useState(false);
    const roomLink = room.link ?? room.id;

    const prefetchOnIntent = () => {
        if (room.visibility !== "public" || eagerPrefetch || hoveredPrefetchRef.current) return;
        hoveredPrefetchRef.current = true;
        router.prefetch(`/${roomLink}`);
    };

    const copyRoomLink = async () => {
        try {
            const path = "/" + roomLink;
            await navigator.clipboard.writeText(window.location.origin + path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
            posthog.capture("room_code_copied", { room_id: room.id });
        } catch (error) {
            console.error("Failed to copy room URL:", error);
        }
    };

    return (
        <article className="flex h-full w-full flex-col rounded-lg bg-(--color-background-secondary) shadow-[8px_8px_0px_0px_var(--color-border)]">
            <div
                className="rounded-lg h-full"
                data-cursor="button"
                data-cursor-shape="1"
            >
                <Link
                    className="flex flex-col items-start h-full gap-4 transition-all duration-(--duration-etb) ease-etb active:scale-95 cursor-pointer"
                    onClick={() => {
                        posthog.capture("play_clicked", { room_id: room.id });
                    }}
                    onNavigate={() => startNavigationProgress()}
                    prefetch={room.visibility === "public" && eagerPrefetch}
                    onMouseEnter={prefetchOnIntent}
                    onFocus={prefetchOnIntent}
                    href={`/${roomLink}`}
                >
                    <div className="flex min-w-0 px-4 pt-4 items-center gap-2">
                        <Icon
                            name={
                                room.visibility === "public"
                                    ? "earth"
                                    : room.visibility === "unlisted"
                                      ? "link"
                                      : "lock"
                            }
                        />
                        <h2
                            className={`min-w-0 flex-1 w-full line-clamp-1 font-bold font-mono  ${!room.title && "italic opacity-50"}`}
                            data-cursor="text"
                        >
                            {room.title || "タイトルなし"}
                        </h2>
                    </div>

                    <p
                        className={`line-clamp-2 w-full px-4 text-start ${!room.explanation && "italic opacity-50"}`}
                        data-cursor="text"
                    >
                        {room.explanation || "説明なし"}
                    </p>

                    <div className="flex flex-wrap gap-4 px-4 pb-4">
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
                                    {room.itemCount ?? room.items?.length ?? 0}
                                </span>
                                <span className="text-sm">個の単語</span>
                            </span>
                        </div>
                    </div>
                </Link>
            </div>

            <div className="mt-auto flex flex-wrap items-center justify-end">
                <Button
                    href={`/${roomLink}`}
                    prefetch={room.visibility === "public" && eagerPrefetch}
                    iconName="play"
                    variant="text"
                    padding="middle"
                />
                <Button
                    href={`/${roomLink}/edit`}
                    prefetch={false}
                    iconName="pen"
                    variant="text"
                    padding="middle"
                />
                <Button
                    onClick={copyRoomLink}
                    iconName={copied ? "check" : "link"}
                    variant="text"
                    padding="middle"
                />
                {onToggleSaved && (
                    <Button
                        onClick={onToggleSaved}
                        iconName={isSaved ? "bookmarkOff" : "bookmark"}
                        variant="text"
                        padding="middle"
                    />
                )}
            </div>
        </article>
    );
}
