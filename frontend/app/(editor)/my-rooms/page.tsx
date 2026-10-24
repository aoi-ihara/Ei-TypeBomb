"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMyRooms } from "@/lib/room/get";
import { Room } from "@/type";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import { createNewRoom } from "@/lib/room/create";
import { Icon } from "@/components/ui/Icon";
import posthog from "posthog-js";
import RoomCard from "@/components/ui/RoomCard";

export default function Profile() {
    const router = useRouter();
    const [creating, setCreating] = useState(false);
    const [rooms, setRooms] = useState<Room[] | null>(null);

    useEffect(() => {
        const fetchUser = async () => {
            const result = await getMyRooms();
            if (!result?.rooms) return;

            setRooms(result.rooms);
            posthog.capture("my_rooms_opened", {
                room_count: result.rooms.length,
            });
        };

        fetchUser();
    }, []);

    const addRoom = async () => {
        setCreating(true);
        const roomId = await createNewRoom();
        posthog.capture("room_created");
        router.push(`/my-rooms/${roomId}`);
    };

    return (
        <Shell
            title="ルーム一覧"
            size="large"
            loading={!rooms}
            animateAppear={true}
        >
            <Button
                loading={creating}
                onClick={() => addRoom()}
                className="w-full"
                iconName="plus"
            >
                追加
            </Button>

            {rooms && rooms.length !== 0 && (
                <div className="w-full grid gap-4">
                    {rooms
                        .sort(
                            (a, b) =>
                                new Date(b.updatedAt ?? 0).getTime() -
                                new Date(a.updatedAt ?? 0).getTime(),
                        )
                        .map((room) => (
                            <RoomCard key={room.id} room={room} />
                        ))}
                </div>
            )}
        </Shell>
    );
}
