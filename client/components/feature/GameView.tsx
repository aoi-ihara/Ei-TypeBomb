"use client";

import type { ReactNode, Ref } from "react";
import ItemView from "@/components/feature/ItemView";
import UsersView from "@/components/feature/UsersView";
import Button from "@/components/ui/Button";
import type { Item, Position, Room, User } from "@/type";
import type {
    LearningMode,
    RecallObservation,
    RecallProgress,
} from "@/lib/playground/memory";
import { getRoomItems } from "@/lib/item";
import GameNotice, {
    type GameNoticeProps,
} from "@/components/feature/GameNotice";

type Props = {
    room: Room | null;
    users: User[];
    positions: Position[];
    userId: string | null;
    currentTurn: number;
    bombStatus: number;
    currentItem: Item | null;
    itemPresentationKey?: number;
    currentInput: string;
    isStarted: boolean;
    isSpectator?: boolean;
    serverError?: string | null;
    notice?: GameNoticeProps;
    result: boolean | null;
    lostDisplayName?: string | null;
    bombRef?: Ref<HTMLDivElement>;
    explosionLayer?: ReactNode;
    resultExtraActions?: ReactNode;
    onSuccess: () => void;
    onChangeInput: (input: string) => void;
    onPlayAgain: () => void;
    onCreateRoom: () => void;
    onJoin?: () => void;
    onWatch?: () => void;
    onStartGame?: () => void;
    onLeave?: () => void;
    enableRemoteTypingSync?: boolean;
    learningMode?: LearningMode;
    initialCueRatio?: number;
    cueSteps?: number[];
    hintDelaysMs?: number[] | null;
    onRecallProgress?: (progress: RecallProgress) => void;
    onRecallComplete?: (observation: RecallObservation) => void;
    stopRecommended?: boolean;
    onStop?: () => void;
};

export default function GameView({
    room,
    users,
    positions,
    userId,
    currentTurn,
    bombStatus,
    currentItem,
    itemPresentationKey = 0,
    currentInput,
    isStarted,
    isSpectator = false,
    serverError = null,
    notice,
    result,
    lostDisplayName,
    bombRef,
    explosionLayer,
    resultExtraActions,
    onSuccess,
    onChangeInput,
    onPlayAgain,
    onCreateRoom,
    onJoin,
    onWatch,
    onStartGame,
    onLeave,
    enableRemoteTypingSync = true,
    learningMode,
    initialCueRatio,
    cueSteps,
    hintDelaysMs,
    onRecallProgress,
    onRecallComplete,
    stopRecommended = false,
    onStop,
}: Readonly<Props>) {
    const currentTurnUser = users[currentTurn] as User | undefined;
    const isParticipant = users.some((user) => user.id === userId);
    const hasDuplicatePrompt =
        currentItem?.type === "typed_recall" &&
        getRoomItems(room).filter(
            (item) =>
                item.type === "typed_recall" &&
                item.prompt === currentItem.prompt,
        ).length > 1;
    const roomHasSpace =
        typeof room?.maxPlayers === "number" &&
        room.maxPlayers > 0 &&
        users.length < room.maxPlayers;

    const activeGame =
        currentItem === null ? (
            <div
                className="font-mono w-fit font-bold text-2xl"
                data-cursor="text"
            >
                ゲーム開始
            </div>
        ) : (
            <div className="flex h-full items-center justify-center flex-col gap-2 w-full">
                {currentTurnUser?.id === userId ? (
                    <div
                        className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                        data-cursor="text"
                    >
                        あなたの番です
                    </div>
                ) : currentTurnUser ? (
                    <div
                        className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                        data-cursor="text"
                    >
                        {currentTurnUser.displayName + "の番です"}
                    </div>
                ) : null}
                <ItemView
                    key={`${currentItem.id}:${currentTurn}:${itemPresentationKey}`}
                    item={currentItem}
                    hasDuplicatePrompt={hasDuplicatePrompt}
                    bombStatus={bombStatus}
                    onSuccess={onSuccess}
                    onChangeInput={(input) => {
                        if (userId === currentTurnUser?.id)
                            onChangeInput(input);
                    }}
                    currentInput={
                        result !== null
                            ? ""
                            : userId === currentTurnUser?.id
                              ? null
                              : currentInput
                    }
                    enableRemoteTypingSync={enableRemoteTypingSync}
                    learningMode={learningMode}
                    initialCueRatio={initialCueRatio}
                    cueSteps={cueSteps}
                    hintDelaysMs={hintDelaysMs}
                    onRecallProgress={onRecallProgress}
                    onRecallComplete={onRecallComplete}
                />
            </div>
        );

    return (
        <div className="flex flex-col md:flex-row w-full h-full">
            {explosionLayer}
            {notice && <GameNotice {...notice} />}

            {result !== null && (
                <div className="bomb-result-enter fixed flex items-center flex-col gap-4 justify-center bg-(--color-background)/75 z-1 top-0 left-0 w-screen h-screen">
                    <div className="w-sm flex flex-col gap-4 items-center animate-appear">
                        <div data-cursor="text" className="font-bold text-4xl">
                            {result
                                ? "あなたの負けです"
                                : `${lostDisplayName ?? "相手"}の負けです`}
                        </div>
                        {stopRecommended && onStop ? (
                            <>
                                <Button
                                    iconName="check"
                                    className="w-full"
                                    variant="primary"
                                    onClick={onStop}
                                >
                                    ここで一区切り
                                </Button>
                                <Button
                                    iconName="rotateCw"
                                    className="w-full"
                                    onClick={onPlayAgain}
                                >
                                    続ける
                                </Button>
                            </>
                        ) : (
                            <Button
                                iconName="rotateCw"
                                className="w-full"
                                variant="primary"
                                onClick={onPlayAgain}
                            >
                                もう一度プレイ
                            </Button>
                        )}
                        <Button
                            iconName="plus"
                            className="w-full"
                            onClick={onCreateRoom}
                        >
                            ルームを作成
                        </Button>
                        {resultExtraActions}
                    </div>
                </div>
            )}

            <div className="max-w-3xl md:order-2 w-full px-4 gap-4 pb-4 pt-4 h-full justify-end flex flex-col">
                <div
                    className={`flex flex-col bg-(--color-background-secondary) transition-all duration-(--duration-etb) ease-etb-game ${serverError ? "min-h-14 h-auto justify-center" : !room ? "h-14" : isSpectator && !isStarted ? "opacity-0 scale-95" : isParticipant ? (isStarted ? (currentTurnUser?.id === userId ? "h-full" : "h-68") : "h-48") : isStarted ? "h-64" : "h-14"} rounded-2xl p-2 w-full`}
                >
                    {serverError ? (
                        <div
                            className="flex justify-start animate-appear w-full"
                            role="alert"
                        >
                            <div
                                className="font-mono w-fit pl-4 font-bold"
                                data-cursor="text"
                            >
                                {serverError}
                            </div>
                        </div>
                    ) : room ? (
                        isParticipant ? (
                            <div className="flex flex-col h-full animate-appear">
                                <div className="flex h-full">
                                    <div className="w-full flex flex-col items-center justify-center gap-4">
                                        {isStarted ? (
                                            activeGame
                                        ) : (
                                            <>
                                                <div
                                                    className="gradient-text h-fit px-2 py-1 font-bold flex"
                                                    data-cursor="text"
                                                >
                                                    ほかのプレイヤーを待っています…
                                                </div>
                                                <div
                                                    className="rounded-lg w-48 flex"
                                                    data-cursor="button"
                                                    data-cursor-shape={
                                                        users.length < 2
                                                            ? "2"
                                                            : "0"
                                                    }
                                                >
                                                    <button
                                                        className={`items-center cursor-pointer font-bold ${users.length < 2 ? "opacity-50" : "active:scale-95"} bg-cyan-600 disabled:opacity-50 w-full justify-center py-2 rounded-lg text-white h-fit flex transition-all duration-(--duration-etb) ease-etb`}
                                                        onClick={() => {
                                                            if (
                                                                users.length > 1
                                                            )
                                                                onStartGame?.();
                                                        }}
                                                    >
                                                        ゲームを開始
                                                    </button>
                                                </div>
                                                <div
                                                    className="rounded-lg w-48 flex"
                                                    data-cursor="button"
                                                    data-cursor-shape="1"
                                                >
                                                    <button
                                                        className="items-center text-center justify-center cursor-pointer font-bold py-2 w-full text-cyan-600 h-fit flex transition-all duration-(--duration-etb) ease-etb active:scale-95"
                                                        onClick={onLeave}
                                                    >
                                                        退出
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full w-full flex justify-center items-center">
                                {roomHasSpace ? (
                                    isStarted ? (
                                        activeGame
                                    ) : (
                                        !isSpectator && (
                                            <>
                                                <div className="w-full animate-appear">
                                                    <div
                                                        className="w-fit pl-4 font-bold"
                                                        data-cursor="text"
                                                    >
                                                        接続しました
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 animate-appear">
                                                    <div
                                                        className="rounded-lg w-14 flex"
                                                        data-cursor="button"
                                                        data-cursor-shape="1"
                                                    >
                                                        <button
                                                            className="items-center text-center justify-center cursor-pointer font-bold py-2 w-full text-cyan-600 h-fit flex transition-all duration-(--duration-etb) ease-etb active:scale-95"
                                                            onClick={onWatch}
                                                        >
                                                            観戦
                                                        </button>
                                                    </div>
                                                    <div
                                                        className="rounded-lg w-20 flex"
                                                        data-cursor="button"
                                                        data-cursor-shape="0"
                                                    >
                                                        <button
                                                            className="items-center font-bold bg-cyan-600 w-full justify-center py-2 rounded-lg text-white h-fit flex transition-all cursor-pointer duration-(--duration-etb) ease-etb active:scale-95"
                                                            onClick={onJoin}
                                                        >
                                                            参加
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )
                                    )
                                ) : (
                                    <div className="flex justify-start animate-appear w-full">
                                        <div
                                            className="font-mono w-fit pl-4 font-bold"
                                            data-cursor="text"
                                        >
                                            このルームは満員です
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    ) : (
                        <div className="w-full h-full flex animate-appear items-center">
                            <div
                                className="w-fit pl-4 font-bold gradient-text"
                                data-cursor="text"
                            >
                                サーバーに接続しています…
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="w-full relative md:order-1 flex justify-center items-center h-full">
                <div
                    className="absolute top-0 left-0 pl-4 md:top-3 w-full flex truncate line-clamp-1 font-bold font-mono text-lg"
                    data-cursor="text"
                >
                    {room?.title}
                </div>
                <UsersView
                    bombRef={bombRef}
                    exploded={result !== null}
                    users={users}
                    positions={positions}
                    userId={userId}
                    currentTurn={isStarted ? currentTurn : null}
                    bombStatus={bombStatus}
                />
            </div>
        </div>
    );
}
