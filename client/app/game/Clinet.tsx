"use client";

type User = {
    displayName: string;
    uuid: string;
    pulse: string;
};

type Position = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export default function Client({
    room,
    uuid,
    cameraAngle,
}: {
    room: User[];
    uuid: string;
    cameraAngle: number;
}) {
    const radius = 75;

    const userPositions: Position[] = room.map((_, index) => {
        const angle = (2 * Math.PI * index) / room.length;

        if (room.length === 1) {
            return {
                x: 0,
                y: 0,
                width: cameraAngle * 32,
                height: cameraAngle * 32,
            };
        }

        return {
            x: Math.sin(angle) * radius * cameraAngle,
            y: Math.cos(angle) * radius * cameraAngle,
            width: cameraAngle * 32,
            height: cameraAngle * 32,
        };
    });

    return (
        <div className="fixed top-0 left-0 flex items-center justify-center w-full h-full">
            <div
                className="relative w-64 h-64 transititransition-all ease-out duration-200 bg-(--color-background-secondary)"
                style={{
                    borderRadius: cameraAngle * 32,
                }}
            >
                {userPositions.map((position, index) => (
                    <div
                        key={index}
                        data-cursor={uuid ? "button" : ""}
                        data-cursor-shape="0"
                        className="absolute transition-all ease-out duration-200 active:scale-95  rounded-full bg-cyan-600 flex justify-center"
                        style={{
                            width: `${position.width}px`,
                            height: `${position.height}px`,
                            left: `calc(50% + ${position.x - position.width / 2}px)`,
                            top: `calc(50% + ${position.y - position.height / 2}px)`,
                        }}
                    >
                        <div
                            className={`absolute -top-5 w-24 flex items-start font-bold justify-center text-xs`}
                        >
                            {room[index].displayName}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
