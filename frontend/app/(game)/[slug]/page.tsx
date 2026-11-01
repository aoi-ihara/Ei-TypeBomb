import { notFound } from "next/navigation";
import { cookies } from "next/headers";
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

    const [result] = await Promise.all([getRoomSummaryFromId(slug), cookies()]);
    if (!result) notFound();

    const { room } = result;
    const itemCount = result.itemCount;
    const items = room.items ?? [];
    const isOwner = result.isOwner;

    return (
        <Shell
            title={title}
            className="grid sm:grid-cols-2 gap-4 px-4"
            showBackButton
            size="xlarge"
            animateAppear
        >
            <section className="flex w-full flex-col gap-4 rounded-lg bg-(--color-background-secondary) p-4">
                {room.explanation && (
                    <div
                        className="line-clamp-3 wrap-anywhere"
                        data-cursor="text"
                    >
                        {room.explanation}
                    </div>
                )}

                <div className="flex items-end gap-2 font-bold">
                    <Icon
                        name={
                            room.visibility === "public"
                                ? "earth"
                                : room.visibility === "unlisted"
                                  ? "link"
                                  : "lock"
                        }
                    />
                    <span
                        className="flex gap-1 items-center"
                        data-cursor="text"
                    >
                        <span className="font-bold font-mono">
                            {room.visibility === "public"
                                ? "公開"
                                : room.visibility === "unlisted"
                                  ? "限定公開"
                                  : "非公開"}
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
            </section>

            <PlayRoom
                roomId={slug}
                alreadyAuthorized={playInfo.authorized}
                itemCount={itemCount}
                isOwner={isOwner}
                slug={slug}
            />

            <section className="flex w-full flex-col gap-4 rounded-lg bg-(--color-background-secondary) p-4">
                {items.length > 0 ? (
                    items.map((item, index) => (
                        <div
                            key={item.id}
                            className={`grid grid-cols-2 ${index !== 0 && "border-t border-(--color-border) pt-4"}`}
                        >
                            <span
                                className="w-full line-clamp-1"
                                data-cursor="text"
                            >
                                {item.prompt}
                            </span>
                            <span
                                className="w-full line-clamp-1"
                                data-cursor="text"
                            >
                                {item.answer}
                            </span>
                        </div>
                    ))
                ) : (
                    <p className="opacity-50" data-cursor="text">
                        単語がありません。
                    </p>
                )}
            </section>
        </Shell>
    );
}
