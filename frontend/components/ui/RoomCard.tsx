import { Room } from "@/type";
import { Icon } from "./Icon";
import Link from "next/link";
import Button from "./Button";

export default function RoomCard({ room }: { room: Room }) {
    return (
        <div className="flex gap-4">
            <div
                key={room.id}
                data-cursor="button"
                className="rounded-lg w-full"
            >
                <Link
                    className="flex cursor-pointer w-full active:scale-95 transition-all duration-(--duration-etb) ease-etb flex-col gap-2 px-4 py-3 h-full rounded-lg bg-(--color-background-secondary)"
                    href={`/my-rooms/${room.id}`}
                >
                    <div className="flex shrink-0 gap-2 items-center">
                        {room.password ? (
                            <Icon name="lock" />
                        ) : (
                            <Icon name="earth" />
                        )}
                        <div
                            className="font-bold w-full text-start font-mono truncate text-lg"
                            data-cursor="text"
                        >
                            {room.title}
                        </div>
                    </div>
                    <div className="text-start line-clamp-2">
                        {room.explanation}
                    </div>
                    <div className="flex items-center gap-1">
                        <Icon name="usersRound" />
                        <div className="font-mono font-bold">
                            {room.maxPlayers}
                        </div>
                    </div>
                </Link>
            </div>
            <div className="flex flex-col gap-4">
                <Button onClick={() => {}} iconName="pen" padding="small" />
                <Button onClick={() => {}} iconName="copy" padding="small" />
                <Button onClick={() => {}} iconName="qrCode" padding="small" />
            </div>
        </div>
    );
}
