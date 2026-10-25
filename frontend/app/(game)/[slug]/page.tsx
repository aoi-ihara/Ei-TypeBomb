import Link from "next/link";
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
            <Shell title="ルーム" size="medium" animateAppear>
                <RoomPasswordGate roomId={slug} />
                <Link href="/" className="py-2 text-center text-sm opacity-60">
                    ルーム一覧に戻る
                </Link>
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
            <p className="w-full text-start opacity-80">
                {room.explanation || "このルームの説明はありません。"}
            </p>

            <div className="flex w-full flex-col gap-3 rounded-xl bg-(--color-background-secondary) p-4">
                <div className="flex items-center gap-2">
                    <Icon name={room.isPublic ? "earth" : "lock"} />
                    <span>{room.isPublic ? "共有ルーム" : "非公開ルーム"}</span>
                </div>
                <div className="flex items-center gap-2">
                    <Icon name="usersRound" />
                    <span>最大 {room.maxPlayers ?? 2} 人</span>
                </div>
                <div className="flex items-center gap-2">
                    <Icon name="list" />
                    <span>{itemCount} 個の単語</span>
                </div>
            </div>

            <PlayRoom
                roomId={slug}
                alreadyAuthorized={playInfo.authorized}
                itemCount={itemCount}
            />

            {isOwner && (
                <Link
                    href={"/" + slug + "/edit"}
                    className="w-full rounded-xl border border-(--color-border) px-4 py-3 text-center font-semibold"
                >
                    ルームを編集
                </Link>
            )}
            <Link href="/" className="py-2 text-center text-sm opacity-60">
                ルーム一覧に戻る
            </Link>
        </Shell>
    );
}
