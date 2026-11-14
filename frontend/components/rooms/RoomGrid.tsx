"use client";

import { useEffect, useRef, useState } from "react";
import type { Room } from "@/type";
import RoomCard from "@/components/rooms/RoomCard";
import Button from "@/components/ui/Button";

const PAGE_SIZE = 24;

export default function RoomGrid({
    rooms,
    savedIds,
    onToggleSaved,
}: {
    rooms: Room[];
    savedIds: string[];
    onToggleSaved?: (roomId: string) => void;
}) {
    const [renderCount, setRenderCount] = useState(PAGE_SIZE);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const hasMore = renderCount < rooms.length;

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (
            !sentinel ||
            !hasMore ||
            typeof IntersectionObserver === "undefined"
        )
            return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setRenderCount((count) =>
                        Math.min(count + PAGE_SIZE, rooms.length),
                    );
                }
            },
            { rootMargin: "400px" },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, rooms.length, renderCount]);

    return (
        <div className="w-full">
            <div className="grid grid-cols-1 sm:grid-cols-2 w-full gap-4">
                {rooms.slice(0, renderCount).map((room, index) => (
                    <RoomCard
                        key={room.id}
                        room={room}
                        isSaved={savedIds.includes(room.id)}
                        eagerPrefetch={index < 2}
                        onToggleSaved={
                            onToggleSaved
                                ? () => onToggleSaved(room.id)
                                : undefined
                        }
                    />
                ))}
            </div>
            {hasMore && (
                <div ref={sentinelRef} className="flex justify-center py-6">
                    <Button
                        variant="text"
                        onClick={() =>
                            setRenderCount((count) =>
                                Math.min(count + PAGE_SIZE, rooms.length),
                            )
                        }
                    >
                        さらに表示
                    </Button>
                </div>
            )}
        </div>
    );
}
