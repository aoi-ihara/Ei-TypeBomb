import type { Ref } from "react";
import Bomb from "./Bomb";
import type { User } from "@/type";

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
}: Readonly<{
    users: User[];
    positions: Position[];
    userId: string | null;
    currentTurn: number | null;
    bombStatus: number;
    bombRef?: Ref<HTMLDivElement>;
    exploded?: boolean;
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
                                opacity: `${position.opacity}`,
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

                <div
                    className="absolute flex transition-all duration-500 w-8 h-8 ease-etb rounded-full animate-[bombBounce_400ms_ease-etb]"
                    key={bombStatus}
                    ref={bombRef}
                    data-bomb-status={bombStatus}
                    style={{
                        visibility: exploded ? "hidden" : undefined,
                        opacity: `${currentTurn !== null ? 1 : 0}`,
                        left: `calc(${
                            currentTurn !== null
                                ? Number(positions[currentTurn]?.x.toFixed(4)) +
                                  50
                                : 50
                        }% - ${
                            currentTurn !== null
                                ? positions[currentTurn]?.w / 2 + 16
                                : 16
                        }px)`,
                        top: `calc(${
                            currentTurn !== null
                                ? Number(positions[currentTurn]?.y.toFixed(4)) +
                                  50
                                : 50
                        }% - ${
                            currentTurn !== null
                                ? positions[currentTurn]?.h / 2 + 8
                                : 16
                        }px)`,
                    }}
                >
                    <Bomb bombStatus={bombStatus} />
                </div>
            </div>
        </div>
    );
}
