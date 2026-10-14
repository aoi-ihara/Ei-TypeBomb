import type { Ref } from "react";
import Bomb from "./Bomb";
import type { GameBomb, User } from "@/type";

type Position = {
    x: number;
    y: number;
    w: number;
    h: number;
    opacity: number;
};

export default function UsersView({
    users,
    positions,
    userId,
    currentTurn,
    bombStatus,
    bombRef,
    exploded = false,
    bombs,
    loserIds = [],
}: Readonly<{
    users: User[];
    positions: Position[];
    userId: string | null;
    currentTurn: number | null;
    bombStatus: number;
    bombRef?: Ref<HTMLDivElement>;
    exploded?: boolean;
    bombs?: GameBomb[];
    loserIds?: string[];
}>) {
    return (
        <div className="h-full w-full flex items-center justify-center">
            <div className="w-96 h-96 flex relative">
                {positions.map((position, index) => {
                    const posX = Number(position.x.toFixed(4));
                    const posY = Number(position.y.toFixed(4));

                    return (
                        <div
                            key={index}
                            className="absolute flex transition-all duration-500 ease-etb rounded-full"
                            style={{
                                opacity: position.opacity * (loserIds.includes(users[index]?.id ?? "") ? 0.5 : 1),
                                width: `${position.w}px`,
                                height: `${position.h}px`,
                                filter: `blur(${(1 - position.opacity) * 12}px)`,
                                left: `calc(${posX + 50}% - ${position.w / 2}px)`,
                                top: `calc(${posY + 50}% - ${position.h / 2}px)`,
                            }}
                        >
                            <div className="bg-(--color-foreground) w-full h-full flex rounded-full relative transition-transform duration-(--duration-etb) ease-etb">
                                <div
                                    className="absolute flex-col pointer-events-none rounded-full transition-all duration-500 ease-etb text-center items-center text-sm pb-2 w-32 flex justify-center"
                                    style={{
                                        left: `calc(${position.w / 2}px - 64px)`,
                                        bottom: `calc(${position.h}px + 4px)`,
                                    }}
                                >
                                    {users[index]?.id === userId && (
                                        <svg
                                            className="w-fit"
                                            xmlns="http://www.w3.org/2000/svg"
                                            height="32px"
                                            viewBox="0 -960 960 960"
                                            width="32px"
                                            fill="currentColor"
                                        >
                                            <path d="M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z" />
                                        </svg>
                                    )}
                                    {users[index]?.displayName ?? ""}
                                </div>
                            </div>
                        </div>
                    );
                })}

                {(bombs ?? (currentTurn === null ? [] : [{
                    id: "legacy", holder: currentTurn, status: bombStatus,
                    at: 0, turn: 0,
                }])).map((bomb, index) => {
                    const place = positions[bomb.holder];
                    if (!place) return null;
                    return (
                        <div
                            key={bomb.id}
                            className="absolute flex transition-all duration-500 w-8 h-8 ease-etb rounded-full animate-[bombBounce_400ms_ease-etb]"
                            ref={index === 0 ? bombRef : undefined}
                            data-bomb-status={bomb.status}
                            style={{
                                visibility: exploded ? "hidden" : undefined,
                                opacity: 1,
                                left: `calc(${Number(place.x.toFixed(4)) + 50}% - ${place.w / 2 + 16 - (index % 3) * 12}px)`,
                                top: `calc(${Number(place.y.toFixed(4)) + 50}% - ${place.h / 2 + 8 + (index % 3) * 10}px)`,
                            }}
                        >
                            <Bomb bombStatus={bomb.status} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
