type User = {
    displayName: string;
    uuid: string;
    pulse: string;
};

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
}: Readonly<{
    users: User[];
    positions: Position[];
}>) {
    return (
        <div className="h-full w-full flex items-center justify-center">
            <div className="w-96 h-96 flex relative">
                {users.map((user, index) => (
                    <div
                        key={user.uuid}
                        className="absolute flex"
                        style={{
                            opacity: 1,
                            width: `${positions[index].w}px`,
                            height: `${positions[index].h}px`,
                            left: `calc(${positions[index].x + 50}% - ${positions[index].w / 2}px)`,
                            top: `calc(${positions[index].y + 50}% - ${positions[index].h / 2}px)`,
                        }}
                    >
                        <div
                            data-cursor="button"
                            data-cursor-shape="0"
                            className="bg-(--color-foreground) w-full h-full flex rounded-full active:scale-95 transition-transform duration-200 ease-out"
                        >
                            <div
                                className="absolute pointer-events-none rounded-full text-center text-sm pb-2"
                                style={{
                                    opacity: 1,
                                    width: "96px",
                                    left: `calc(${positions[index].x + 50}% - 48px)`,
                                    bottom: `calc(${positions[index].y + 50}% + ${positions[index].h / 2}px)`,
                                }}
                            >
                                vgnz93hs
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
