import { User, GameState } from "@/types";

type Position = {
    displayName: string;
    x: number;
    y: number;
    w: number;
    h: number;
    opacity: number;
};

export default function UsersView({
    gameState,
    myUser,
}: Readonly<{
    gameState: GameState;
    myUser: User;
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

    const style = bombStyles[gameState.bombStatus ?? 0];

    const positions: Position[] = gameState.users.map((user, index) => {
        return {
            displayName: user.displayName,
            x: Math.cos((index / gameState.users.length) * Math.PI * 2),
            y: Math.sin((index / gameState.users.length) * Math.PI * 2),
            w: 32,
            h: 32,
            opacity: 0,
        };
    });

    return (
        <div className="h-full w-full flex items-center justify-center">
            <div className="w-96 h-96 flex relative">
                {gameState.users.map((user, index) => (
                    <div
                        key={index}
                        className="absolute flex transition-all duration-500 ease-[cubic-bezier(0.1,0.5,0,1)] rounded-full"
                        style={{
                            opacity: `${positions[index].opacity}`,
                            width: `${positions[index].w}px`,
                            height: `${positions[index].h}px`,
                            left: `calc(${positions[index].x + 50}% - ${positions[index].w / 2}px)`,
                            top: `calc(${positions[index].y + 50}% - ${positions[index].h / 2}px)`,
                        }}
                    >
                        <div className="bg-(--color-foreground) w-full h-full flex rounded-full relative transition-transform duration-200 ease-out">
                            <div
                                className="absolute flex-col pointer-events-none rounded-full transition-all duration-500 ease-[cubic-bezier(0.1,0.5,0,1)] text-center items-center text-sm pb-2 w-32 flex justify-center"
                                style={{
                                    left: `calc(${positions[index].w / 2}px - 64px)`,
                                    bottom: `calc(${positions[index].h}px + 4px)`,
                                }}
                            >
                                {gameState.users[index].userId ==
                                    myUser.userId && (
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
                                {gameState.users[index].displayName ?? ""}
                            </div>
                        </div>
                    </div>
                ))}

                <div
                    className="absolute flex transition-all duration-500 w-8 h-8 ease-[cubic-bezier(0.1,0.5,0,1)] rounded-full animate-[bombBounce_400ms_ease-out]"
                    key={gameState.bombStatus}
                    style={{
                        opacity: `${gameState.status !== "playing" ? 1 : 0}`,
                        left: `calc(${gameState.status !== "playing" && gameState.bombHolder ? positions[gameState.bombHolder].x + 50 : 50}% - ${gameState.status !== "playing" && gameState.bombHolder ? positions[gameState.bombHolder].w / 2 + 16 : 16}px)`,
                        top: `calc(${gameState.status !== "playing" && gameState.bombHolder ? positions[gameState.bombHolder].y + 50 : 50}% - ${gameState.status !== "playing" && gameState.bombHolder ? positions[gameState.bombHolder].h / 2 + 8 : 16}px)`,
                    }}
                >
                    <svg
                        key={gameState.bombStatus}
                        width="32"
                        height="32"
                        viewBox="0 0 128 128"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{
                            filter: `drop-shadow(0 0 6px ${style.glow})`,
                        }}
                        className="transition-colors duration-200 ease-out"
                    >
                        <path
                            fill="none"
                            stroke={style.fuse}
                            strokeWidth="8"
                            strokeLinecap="square"
                            d="M 89 17 C 89 17 98.633644 0.72097 109 10 C 121.635551 21.310211 103.181946 45.948578 108 52 C 114.241898 59.839752 123 53 123 53"
                            className="transition-colors duration-200 ease-out"
                        />

                        <path
                            fill={style.body}
                            fillRule="evenodd"
                            d="M 95.835754 43.140877 C 101.60791 51.293633 105 61.250687 105 72 C 105 99.614235 82.614235 122 55 122 C 27.385763 122 5 99.614235 5 72 C 5 44.385765 27.385763 22 55 22 C 57.070099 22 59.110813 22.125801 61.114918 22.370178 L 66.844559 12.446152 C 69.053696 8.619812 73.946419 7.308807 77.772758 9.517952 L 98.950966 21.745193 C 102.777306 23.95433 104.088303 28.847054 101.87"
                            className="transition-colors duration-200 ease-out"
                        />
                    </svg>
                </div>
            </div>
        </div>
    );
}
