"use client";

import { useState, useEffect } from "react";
import { getSession } from "@/lib/auth/session";
import { useRouter } from "next/navigation";
import { getMyRooms } from "@/lib/room/get";
import { Room } from "@/type";
import Shell from "@/components/layout/Shell";

export default function Profile() {
    const router = useRouter();
    const [rooms, setRooms] = useState<Room[] | null>(null);
    const [userId, setUserId] = useState<string | null>("");

    useEffect(() => {
        const fetchUser = async () => {
            const result = await getMyRooms();
            setUserId(result?.userId ?? null);
            if (!result?.rooms) return;

            setRooms(result.rooms);
        };

        fetchUser();
    }, []);

    return (
        <Shell title="My Rooms" size="large">
            {rooms == null ? (
                <div
                    className="gradient-text fonr-mono font-bold"
                    data-cursor="text"
                >
                    Loading…
                </div>
            ) : (
                <div className="w-full grid gap-5 grid-cols-[repeat(auto-fit,minmax(128px,1fr))]">
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
                                <button className="flex w-full active:scale-95 transition-all duration-200 ease-out flex-col gap-2 px-4 py-3 h-64 rounded-lg bg-(--color-background-secondary)">
                                    <div
                                        className="font-bold flex font-mono text-lg"
                                        data-cursor="text"
                                    >
                                        {room.title}
                                    </div>
                                    <div className="flex">
                                        {room.explanation}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            height="20px"
                                            viewBox="0 -960 960 960"
                                            width="20px"
                                            fill="currentColor"
                                        >
                                            <path d="M40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm720 0v-120q0-44-24.5-84.5T666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120H760ZM247-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm466 0q-47 47-113 47-11 0-28-2.5t-28-5.5q27-32 41.5-71t14.5-81q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113q0 66-47 113Z" />
                                        </svg>
                                        <div>{room.maxPlayers}</div>
                                    </div>
                                </button>
                            </div>
                        ))}
                </div>
            )}
        </Shell>
    );
}
