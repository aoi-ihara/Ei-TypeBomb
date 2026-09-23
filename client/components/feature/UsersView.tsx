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
}: Readonly<{
    users: User[];
    positions: Position[];
    userId: string | null;
    currentTurn: number | null;
    bombStatus: number;
}>) {
    const bombStyles = [
        {
            body: "#111111",
            fuse: "#7f1d1d",
            glow: "rgba(255,255,255,0.25)",
        },
        {
            body: "#222222",
            fuse: "#dc2626",
            glow: "rgba(251,146,60,0.5)",
        },
        {
            body: "#5b3a29",
            fuse: "#f97316",
            glow: "rgba(251,146,60,0.8)",
        },
        {
            body: "#7f1d1d",
            fuse: "#facc15",
            glow: "rgba(250,204,21,1)",
        },
        {
            body: "#dc2626",
            fuse: "#fde047",
            glow: "rgba(255,80,80,1)",
        },
    ];

    const styleIndex = Math.min(Math.max(0, bombStatus), bombStyles.length - 1);
    const style = bombStyles[styleIndex];
    const bombShakeDuration =
        bombStatus === 0 ? null : `${Math.max(100, 700 - bombStatus * 150)}ms`;

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
                    style={{
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
                    <svg
                        key={bombStatus}
                        width="32"
                        height="32"
                        viewBox="0 0 128 128"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{
                            filter: `drop-shadow(0 0 6px ${style.glow})`,
                            animation:
                                bombShakeDuration === null
                                    ? undefined
                                    : `bombShake ${bombShakeDuration} ease-in-out infinite`,
                        }}
                        className={`transition-colors duration-(--duration-etb) ease-etb ${bombShakeDuration === null ? "" : "bomb-shake"}`}
                    >
                        <path
                            fill="none"
                            stroke={style.fuse}
                            strokeWidth="8"
                            strokeLinecap="square"
                            d="M 89 17 C 89 17 98.633644 0.72097 109 10 C 121.635551 21.310211 103.181946 45.948578 108 52 C 114.241898 59.839752 123 53 123 53"
                            className="transition-colors duration-(--duration-etb) ease-etb"
                        />

                        <path
                            fill={style.body}
                            fillRule="evenodd"
                            d="M 95.835754 43.140877 C 101.60791 51.293633 105 61.250687 105 72 C 105 99.614235 82.614235 122 55 122 C 27.385763 122 5 99.614235 5 72 C 5 44.385765 27.385763 22 55 22 C 57.070099 22 59.110813 22.125801 61.114918 22.370178 L 66.844559 12.446152 C 69.053696 8.619812 73.946419 7.308807 77.772758 9.517952 L 98.950966 21.745193 C 102.777306 23.95433 104.088303 28.847054 101.87"
                            className="transition-colors duration-(--duration-etb) ease-etb"
                        />
                    </svg>
                </div>
            </div>
        </div>
    );
}
