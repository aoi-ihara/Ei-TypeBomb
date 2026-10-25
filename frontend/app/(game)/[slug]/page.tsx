import { notFound } from "next/navigation";
import Shell from "@/components/layout/Shell";
import { Icon } from "@/components/ui/Icon";
import { getRoomPlayInfoFromId, getRoomSummaryFromId } from "@/lib/room/get";
import PlayRoom from "./PlayRoom";
import RoomPasswordGate from "./RoomPasswordGate";

export default async function RoomPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const playInfo = await getRoomPlayInfoFromId(slug);
    if (!playInfo?.exists) notFound();

    const title = playInfo.title || "ルーム";

    if (playInfo.requiresPassword && !playInfo.authorized) {
        return (
            <Shell title="パスワードを入力" size="medium" animateAppear>
                <RoomPasswordGate roomId={slug} />
            </Shell>
        );
    }

    const result = await getRoomSummaryFromId(slug);
    if (!result) notFound();

    const { room } = result;
    const itemCount = result.itemCount;
    const isOwner = result.isOwner;

    return (
        <Shell title={title} size="medium" animateAppear>
            {room.explanation && (
                <p className="w-full text-start" data-cursor="text">
                    {room.explanation}
                </p>
            )}

            <div className="flex w-full flex-col gap-4 rounded-lg bg-(--color-background-secondary) p-4">
                <div className="flex items-end gap-2 font-bold">
                    <Icon name={room.isPublic ? "earth" : "lock"} />
                    <span
                        className="flex gap-1 items-center"
                        data-cursor="text"
                    >
                        <span className="font-bold font-mono">
                            {room.isPublic ? "共有" : "非公開"}
                        </span>
                    </span>
                </div>

                <div className="flex items-end gap-2">
                    <Icon name="usersRound" />
                    <span
                        className="flex gap-1 items-center"
                        data-cursor="text"
                    >
                        <span className="opacity-50 text-sm">最大</span>
                        <span className="font-bold font-mono">
                            {room.maxPlayers ?? 2}
                        </span>
                        <span className="opacity-50 text-sm">人</span>
                    </span>
                </div>

                <div className="flex items-end gap-2">
                    <Icon name="playingCardsFan" />
                    <span
                        className="flex gap-1 items-center"
                        data-cursor="text"
                    >
                        <span className="font-bold font-mono">{itemCount}</span>
                        <span className="opacity-50 text-sm">個の単語</span>
                    </span>
                </div>
            </div>

            <PlayRoom
                roomId={slug}
                alreadyAuthorized={playInfo.authorized}
                itemCount={itemCount}
                isOwner={isOwner}
                slug={slug}
            />
        </Shell>
    );
}
