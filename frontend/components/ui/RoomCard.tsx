import { Room } from "@/type";
import { Icon } from "./Icon";
import Button from "./Button";

export default function RoomCard({ room }: { room: Room }) {
    return (
        <div className="flex w-full flex-col gap-2 px-4 py-3 h-full rounded-lg bg-(--color-background-secondary) min-w-0">
            <div className="flex shrink-0 gap-2 w-full items-center min-w-0">
                <div className="shrink-0">
                    {room.password ? (
                        <Icon name="lock" />
                    ) : (
                        <Icon name="earth" />
                    )}
                </div>
                <div
                    className="font-bold min-w-0 flex-1 text-start font-mono truncate text-lg"
                    data-cursor="text"
                >
                    {room.title}
                </div>
            </div>

            <div className="text-start line-clamp-2 w-full min-w-0">
                {room.explanation}
            </div>

            <div className="flex w-full items-center gap-1 min-w-0">
                <Icon name="usersRound" />
                <div className="font-mono font-bold">{room.maxPlayers}</div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 min-w-0">
                <Button onClick={() => {}} iconName="play" variant="text">
                    プレイ
                </Button>
                <Button onClick={() => {}} iconName="pen" variant="text">
                    編集
                </Button>
                <Button onClick={() => {}} iconName="copy" variant="text">
                    リンクをコピー
                </Button>
            </div>
        </div>
    );
}
