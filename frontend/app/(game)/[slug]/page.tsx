import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/layout/Shell";
import { Icon } from "@/components/ui/Icon";
import { getRoomPlayInfoFromId, getRoomSummaryFromId } from "@/lib/room/get";
import { getPlaygroundRoom } from "@/lib/room/playground";
import PlayRoom from "./PlayRoom";

export default async function RoomPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const [playInfo, authorizedRoom] = await Promise.all([
        getRoomPlayInfoFromId(slug),
        getPlaygroundRoom(),
    ]);
    if (!playInfo) notFound();

    const result = await getRoomSummaryFromId(slug);
    const room = result?.room;
    const itemCount = result?.itemCount ?? playInfo.itemCount;
    const isOwner = result?.isOwner ?? false;
    const title = room?.title || playInfo.title || "ルーム";

    return (
        <Shell title={title} size="medium" animateAppear>
            {room ? (
                <>
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
                </>
            ) : (
                <p className="w-full text-start text-sm opacity-70">
                    このルームは非公開です。パスワードを入力して参加してください。
                </p>
            )}

            <PlayRoom
                roomId={slug}
                alreadyAuthorized={authorizedRoom?.id === slug}
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
