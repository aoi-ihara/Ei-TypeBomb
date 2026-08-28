"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMyRooms } from "@/lib/room/get";
import { Room } from "@/type";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import { createNewRoom } from "@/lib/room/create";
import { Icon } from "@/components/ui/Icon";

export default function Profile() {
    const router = useRouter();
    const [rooms, setRooms] = useState<Room[] | null>(null);

    useEffect(() => {
        const fetchUser = async () => {
            const result = await getMyRooms();
            if (!result?.rooms) return;

            setRooms(result.rooms);
        };

        fetchUser();
    }, []);

    const addRoom = async () => {
        const roomId = await createNewRoom();
        router.push(`/my-rooms/${roomId}`);
    };

    return (
        <Shell title="My Rooms" size="large">
            {rooms === null ? (
                <div
                    className="gradient-text fonr-mono font-bold"
                    data-cursor="text"
                >
                    Loading…
                </div>
            ) : (
                <>
                    {rooms && rooms.length !== 0 && (
                        <div className="w-full grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                            {rooms
                                .sort(
                                    (a, b) =>
                                        new Date(b.updatedAt ?? 0).getTime() -
                                        new Date(a.updatedAt ?? 0).getTime(),
                                )
                                .map((room) => (
                                    <div
                                        key={room.id}
                                        data-cursor="button"
                                        className="rounded-lg"
                                    >
                                        <button
                                            className="flex w-full active:scale-95 transition-all duration-200 ease-out flex-col gap-2 px-4 py-3 h-48 rounded-lg bg-(--color-background-secondary)"
                                            onClick={() =>
                                                router.push(
                                                    `/my-rooms/${room.id}`,
                                                )
                                            }
                                        >
                                            {rooms && (
                                                <div className="flex shrink-0 gap-2 items-center">
                                                    {room.password ? (
                                                        <Icon name="lock" />
                                                    ) : (
                                                        <Icon name="earth" />
                                                    )}
                                                    <div
                                                        className="font-bold w-full text-start font-mono truncate text-lg"
                                                        data-cursor="text"
                                                    >
                                                        {room.title}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="text-start line-clamp-2">
                                                {room.explanation}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Icon name="usersRound" />
                                                <div className="font-mono font-bold">
                                                    {room.maxPlayers}
                                                </div>
                                            </div>
                                        </button>
                                    </div>
                                ))}
                        </div>
                    )}

                    <Button
                        onClick={() => addRoom()}
                        className="w-full"
                        iconName="plus"
                    >
                        Add
                    </Button>
                </>
            )}
        </Shell>
    );
}
