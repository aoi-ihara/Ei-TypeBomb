import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/layout/Shell";
import { Icon } from "@/components/ui/Icon";
import { getRoomSummaryFromId } from "@/lib/room/get";

export default async function RoomPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const result = await getRoomSummaryFromId(slug);
    if (!result) notFound();

    const { room, itemCount, isOwner } = result;

    return (
        <Shell title={room.title || "ルーム"} size="medium" animateAppear>
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

            {itemCount === 0 && (
                <p className="w-full text-sm text-red-500">
                    このルームには単語がありません。ルームの所有者が単語を追加するまでプレイできません。
                </p>
            )}

            {itemCount > 0 && (
                <Link
                    href={"/" + room.id + "/play"}
                    className="w-full rounded-xl bg-cyan-600 px-4 py-3 text-center font-semibold text-white transition-transform active:scale-[0.98]"
                >
                    プレイする
                </Link>
            )}
            {isOwner && (
                <Link
                    href={"/" + room.id + "/edit"}
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
