import { notFound, redirect } from "next/navigation";
import Shell from "@/components/layout/Shell";
import { Icon } from "@/components/ui/Icon";
import { getRoomPageDataFromLink } from "@/lib/room/get";
import PlayRoom from "./PlayRoom";
import RoomPasswordGate from "./RoomPasswordGate";
import RoomShareActions from "./RoomShareActions";
import Header from "@/components/layout/Header";
import RoomNavigation from "@/components/rooms/RoomNavigation";
import { isAllowedTypingAnswer } from "@/lib/room/importWords";

export default async function RoomPage({
    params,
}: {
    params: Promise<{ link: string }>;
}) {
    const { link } = await params;
    const result = await getRoomPageDataFromLink(link);
    if (!result) notFound();
    if (link !== result.link) redirect("/" + result.link);

    if (result.requiresPassword && !result.authorized) {
        return (
            <>
                <Header />
                <Shell title="パスワードを入力" size="medium" animateAppear>
                    <RoomPasswordGate roomId={result.id} />
                </Shell>
            </>
        );
    }

    if (!result.room) notFound();

    const { room, itemCount, isOwner, authorized } = result;
    const title = room.title || "ルーム";
    const items = room.items ?? [];
    const hasTypingAnswers = items.some((item) =>
        isAllowedTypingAnswer(item.answer),
    );

    return (
        <>
            <Header />

            <div className="flex w-full flex-col sm:flex-row gap-12 sm:gap-0">
                <RoomNavigation isSignedIn={authorized} />
                <Shell
                    title={title}
                    className="grid lg:grid-cols-2 gap-4 px-4"
                    showBackButton
                    size="xlarge"
                >
                    <section className="w-full flex-col flex gap-4">
                        <div className="flex w-full p-4 flex-col gap-4 rounded-lg bg-(--color-background-secondary)">
                            {room.explanation && (
                                <div
                                    className="line-clamp-3 wrap-anywhere"
                                    data-cursor="text"
                                >
                                    {room.explanation}
                                </div>
                            )}
                            <div className="flex items-end gap-2">
                                <Icon name="usersRound" />
                                <span
                                    className="flex gap-1 items-center"
                                    data-cursor="text"
                                >
                                    <span className="opacity-50 text-sm">
                                        最大
                                    </span>
                                    <span className="font-bold font-mono">
                                        {room.maxPlayers ?? 2}
                                    </span>
                                    <span className="opacity-50 text-sm">
                                        人
                                    </span>
                                </span>
                            </div>
                            <div className="flex items-end gap-2">
                                <Icon name="playingCardsFan" />
                                <span
                                    className="flex gap-1 items-center"
                                    data-cursor="text"
                                >
                                    <span className="font-bold font-mono">
                                        {itemCount}
                                    </span>
                                    <span className="opacity-50 text-sm">
                                        個の単語
                                    </span>
                                </span>
                            </div>
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
                        </div>
                        <RoomShareActions
                            link={result.link}
                            roomId={result.id}
                        />
                    </section>

                    <PlayRoom
                        roomId={result.id}
                        link={result.link}
                        alreadyAuthorized={result.authorized}
                        itemCount={itemCount}
                        hasTypingAnswers={hasTypingAnswers}
                        isOwner={isOwner}
                    />

                    <section className="flex w-full flex-col gap-4 rounded-lg bg-(--color-background-secondary) px-4 py-3">
                        {items.length > 0 ? (
                            items.map((item, index) => (
                                <div
                                    key={item.id}
                                    className={`grid font-mono grid-cols-2 ${index !== 0 && "border-t border-(--color-border) pt-4"}`}
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
                            <p className="opacity-50 italic" data-cursor="text">
                                単語なし
                            </p>
                        )}
                    </section>
                </Shell>
            </div>
        </>
    );
}
