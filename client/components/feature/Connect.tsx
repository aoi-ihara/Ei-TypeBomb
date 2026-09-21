"use client";

type User = {
    displayName: string;
    uuid: string;
    pulse: string;
};

export default function Connect({
    isConnected,
    handleConnect,
    showCursor,
    room,
}: {
    isConnected: boolean;
    handleConnect: () => void;
    showCursor: boolean;
    room: User[];
}) {
    return (
        <div
            className={`flex flex-col ${!isConnected && "loading"} w-fit items-center gap-4`}
        >
            <div className="flex items-end">
                <h1
                    className="font-mono font-bold flex text-2xl"
                    data-cursor="text"
                >
                    {isConnected
                        ? "Connected to Server"
                        : "Connecting to Server"}
                </h1>
                <div
                    className={`w-3 h-1 mb-1 flex ml-1 bg-cyan-600 ${!showCursor && "opacity-0"}`}
                />
            </div>

            <button
                data-cursor={isConnected && room.length < 4 ? "button" : ""}
                className={`text-lg mt-2 items-center font-bold w-48 justify-center py-2 rounded-lg text-white disabled:text-(--color-foreground)/50 flex transition-all duration-(--duration-etb) ease-etb active:scale-95 ${isConnected ? "bg-cyan-600 disabled:bg-(--color-background-secondary)" : "gradient-background"}`}
                data-cursor-shape="0"
                disabled={!isConnected || room.length >= 4}
                onClick={() => handleConnect()}
            >
                Join
            </button>
            {room.length >= 4 && (
                <p
                    className="text-sm text-(--color-foreground) mt-2 font-bold"
                    data-cursor="text"
                >
                    Room is full
                </p>
            )}
        </div>
    );
}
