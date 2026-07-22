"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMyRooms } from "@/lib/room/get";
import { Room } from "@/type";
import Shell from "@/components/layout/Shell";

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
                                <button
                                    className="flex w-full active:scale-95 transition-all duration-200 ease-out flex-col gap-2 px-4 py-3 h-48 rounded-lg bg-(--color-background-secondary)"
                                    onClick={() =>
                                        router.push(`/my-rooms/${room.id}`)
                                    }
                                >
                                    <div className="flex gap-2 items-center">
                                        {room.password ? (
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                height="20px"
                                                viewBox="0 -960 960 960"
                                                width="20px"
                                                fill="currentColor"
                                            >
                                                <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm296.5-223.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z" />
                                            </svg>
                                        ) : (
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                height="20px"
                                                viewBox="0 -960 960 960"
                                                width="20px"
                                                fill="currentColor"
                                            >
                                                <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-7-.5-14.5T799-507q-5 29-27 48t-52 19h-80q-33 0-56.5-23.5T560-520v-40H400v-80q0-33 23.5-56.5T480-720h40q0-23 12.5-40.5T563-789q-20-5-40.5-8t-42.5-3q-134 0-227 93t-93 227h200q66 0 113 47t47 113v40H400v110q20 5 39.5 7.5T480-160Z" />
                                            </svg>
                                        )}
                                        <div
                                            className="font-bold font-mono truncate text-lg"
                                            data-cursor="text"
                                        >
                                            {room.title}
                                        </div>
                                    </div>
                                    <div className="text-start line-clamp-2">
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
