"use client";

import {
    DndContext,
    PointerSensor,
    type Modifier,
    closestCenter,
    useSensor,
    useSensors,
    DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
    arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, useEffect, useRef, useCallback } from "react";
import { getRoomFromId, getRoomFromLink } from "@/lib/room/get";
import {
    rebaseEditorSnapshot,
    sameEditorSnapshot,
    snapshotFromRoom,
    type EditorSnapshot,
} from "@/lib/room/editor-rebase";
import { validRoomUpdate } from "@/lib/room/partial-update";
import { updateRoomFromId } from "@/lib/room/update";
import { parseImportedWords, exportAnswerPairs } from "@/lib/room/importWords";
import type { LegacyWord, Room, RoomVisibility, TypedRecallItem } from "@/type";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import {
    validateExplanation,
    validateLink,
    validateTitle,
} from "@/lib/auth/validator";
import posthog from "posthog-js";
import Shell from "@/components/layout/Shell";
import Dialog from "@/components/ui/Dialog";
import { deleteRoom } from "@/lib/room/delete";
import Collapsible from "@/components/ui/Collapsible";
import { generateWordsAction, getGeminiUsageAction } from "@/lib/AI/actions";
import Picker from "@/components/ui/Picker";
import Selection from "@/components/ui/Selection";
import MorphDialog from "@/components/ui/MorphDialog";
import RoomNavigation from "@/components/rooms/RoomNavigation";

const VISIBILITY_OPTIONS: RoomVisibility[] = ["public", "unlisted", "private"];

function SortableItem({
    id,
    children,
}: {
    id: string;
    children: React.ReactNode;
}) {
    const { attributes, listeners, setNodeRef, transform, transition } =
        useSortable({ id });

    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
            }}
            className="flex gap-4"
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing flex items-center px-2 select-none"
            >
                ☰
            </div>
            {children}
        </div>
    );
}

export default function EditorClient({
    link,
    initialRoom,
}: {
    link: string;
    initialRoom: Room;
}) {
    const router = useRouter();
    const [roomExplanation, setRoomExplanation] = useState(
        initialRoom.explanation ?? "",
    );
    const [roomTitle, setRoomTitle] = useState(initialRoom.title ?? "");
    const [roomVisibility, setRoomVisibility] = useState<RoomVisibility>(
        initialRoom.visibility ?? "unlisted",
    );
    const [gameDuration, setGameDuration] = useState(
        initialRoom.gameDuration ?? 20,
    );
    const [bombCount, setBombCount] = useState<number | null>(
        initialRoom.bombCount ?? null,
    );
    const [maxPlayers, setMaxPlayers] = useState<string>(
        initialRoom.maxPlayers?.toString() ?? "2",
    );
    const roomId = initialRoom.id;
    const savedRouteLinkRef = useRef(link);
    const [items, setItems] = useState<TypedRecallItem[] | null>(
        initialRoom.items ?? [],
    );
    const [roomLink, setRoomLink] = useState(
        initialRoom.link ?? initialRoom.id,
    );
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [isDeletingRoom, setIsDeletingRoom] = useState(false);
    const [showImportDialog, setShowImportDialog] = useState(false);
    const [importData, setImportData] = useState("");
    const [importError, setImportError] = useState("");
    const [showImportInput, setShowImportInput] = useState(false);
    const [showVisibilitySettings, setShowVisibilitySettings] = useState(false);

    const [newPassword, setNewPassword] = useState("");
    const [visibilitySelection, setVisibilitySelection] =
        useState<RoomVisibility>(initialRoom.visibility ?? "unlisted");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [isExported, setIsExported] = useState(false);
    const [exportError, setExportError] = useState("");

    const [showGenerationInput, setShowGenerationInput] = useState(false);
    const [generationPrompt, setGenerationPrompt] = useState("");
    const [generatedWords, setGeneratedWords] = useState<LegacyWord[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationError, setGenerationError] = useState("");
    const [isGeminiLimitReached, setIsGeminiLimitReached] = useState(false);
    const [isGeminiUsageLoading, setIsGeminiUsageLoading] = useState(true);

    const [visibilityError, setVisibilityError] = useState("");
    const [isUpdatingVisibilitySettings, setIsUpdatingVisibilitySettings] =
        useState(false);
    const [showPlayWarning, setShowPlayWarning] = useState(false);

    // Do not auto-save restored Next.js/bfcache state until it is checked against the DB.
    const isLoadedRef = useRef(false);
    const editVersionRef = useRef(initialRoom.editVersion ?? -1);
    const syncedSnapshotRef = useRef(snapshotFromRoom(initialRoom));
    const pendingLatestRoomRef = useRef<Room | null>(null);
    const refreshSequenceRef = useRef(0);
    const saveGenerationRef = useRef(0);
    const [editorSyncError, setEditorSyncError] = useState("");
    const [syncRevision, setSyncRevision] = useState(0);
    const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const maxSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

    useEffect(() => {
        let cancelled = false;

        const loadGeminiUsage = async () => {
            try {
                const usage = await getGeminiUsageAction();
                if (!cancelled) {
                    setIsGeminiLimitReached(usage.remaining <= 0);
                }
            } catch (error) {
                console.error("Failed to load Gemini usage:", error);
            } finally {
                if (!cancelled) setIsGeminiUsageLoading(false);
            }
        };

        loadGeminiUsage();

        return () => {
            cancelled = true;
        };
    }, []);

    const refreshGeminiUsage = async () => {
        try {
            const usage = await getGeminiUsageAction();
            setIsGeminiLimitReached(usage.remaining <= 0);
        } catch (error) {
            console.error("Failed to refresh Gemini usage:", error);
        }
    };

    const roomDataRef = useRef({
        roomTitle,
        roomExplanation,
        maxPlayers,
        gameDuration,
        bombCount,
        items,
        roomId,
        roomLink,
    });

    useEffect(() => {
        roomDataRef.current = {
            roomTitle,
            roomExplanation,
            maxPlayers,
            gameDuration,
            bombCount,
            items,
            roomId,
            roomLink,
        };
    }, [
        roomTitle,
        roomExplanation,
        maxPlayers,
        gameDuration,
        bombCount,
        items,
        roomId,
        roomLink,
    ]);

    const applyEditorSnapshot = useCallback((snapshot: EditorSnapshot) => {
        roomDataRef.current = snapshot;
        setRoomTitle(snapshot.roomTitle);
        setRoomExplanation(snapshot.roomExplanation);
        setMaxPlayers(snapshot.maxPlayers);
        setGameDuration(snapshot.gameDuration);
        setBombCount(snapshot.bombCount);
        setItems(snapshot.items);
        setRoomLink(snapshot.roomLink);
    }, []);

    const applyLatestRoom = (room: Room) => {
        const latest = snapshotFromRoom(room);
        syncedSnapshotRef.current = latest;
        editVersionRef.current = room.editVersion ?? -1;
        pendingLatestRoomRef.current = null;
        setEditorSyncError("");
        setRoomVisibility(room.visibility ?? "unlisted");
        applyEditorSnapshot(latest);
        isLoadedRef.current = true;
    };

    const refreshRoomData = useCallback(async (): Promise<boolean> => {
        const refreshSequence = ++refreshSequenceRef.current;
        ++saveGenerationRef.current;
        isLoadedRef.current = false;

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        if (maxSaveTimerRef.current) clearTimeout(maxSaveTimerRef.current);
        saveTimerRef.current = null;
        maxSaveTimerRef.current = null;

        try {
            // A server action makes a new DB request even after browser back/forward.
            const latest = await getRoomFromId(roomId);
            if (refreshSequence !== refreshSequenceRef.current) return false;
            if (!latest || latest.editVersion === undefined) {
                throw new Error("Could not read the latest room revision");
            }

            const latestSnapshot = snapshotFromRoom(latest);
            const merged = rebaseEditorSnapshot(
                syncedSnapshotRef.current,
                roomDataRef.current,
                latestSnapshot,
            );

            if (!merged) {
                // Do not discard locally edited data or overwrite a newer remote edit.
                pendingLatestRoomRef.current = latest;
                setEditorSyncError(
                    "別の場所で同じ項目が変更されました。保存を中断しています。",
                );
                return false;
            }

            syncedSnapshotRef.current = latestSnapshot;
            editVersionRef.current = latest.editVersion;
            pendingLatestRoomRef.current = null;
            setEditorSyncError("");
            setRoomVisibility(latest.visibility ?? "unlisted");
            applyEditorSnapshot(merged);
            isLoadedRef.current = true;
            // Re-evaluate auto-save even if the user edited while the refresh
            // was pending and the merged field references did not change.
            setSyncRevision((revision) => revision + 1);
            return true;
        } catch (error) {
            if (refreshSequence !== refreshSequenceRef.current) return false;
            console.error("Failed to refresh room editor:", error);
            setEditorSyncError(
                "ルームの最新情報を取得できませんでした。再読み込みしてください。",
            );
            return false;
        }
    }, [roomId, applyEditorSnapshot]);

    useEffect(() => {
        const refreshSequence = refreshSequenceRef;
        queueMicrotask(() => void refreshRoomData());
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) void refreshRoomData();
        };
        const onPopState = () => {
            // Also cover client-side history navigation where pageshow is not fired.
            if (window.location.pathname.endsWith("/edit"))
                void refreshRoomData();
        };
        window.addEventListener("pageshow", onPageShow);
        window.addEventListener("popstate", onPopState);
        return () => {
            ++refreshSequence.current;
            window.removeEventListener("pageshow", onPageShow);
            window.removeEventListener("popstate", onPopState);
        };
    }, [refreshRoomData]);

    const itemListRef = useRef<HTMLDivElement | null>(null);

    const restrictWordDrag: Modifier = ({ transform, activeNodeRect }) => {
        const list = itemListRef.current;

        if (!list || !activeNodeRect) {
            return { ...transform, x: 0 };
        }

        const rect = list.getBoundingClientRect();
        const minY = rect.top - activeNodeRect.top;
        const maxY = rect.bottom - activeNodeRect.bottom;

        return {
            ...transform,
            x: 0,
            y: Math.min(Math.max(transform.y, minY), maxY),
        };
    };

    const sensors = useSensors(useSensor(PointerSensor));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id || !items) return;

        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);

        setItems(arrayMove(items, oldIndex, newIndex));
    };

    const handleDeleteRoom = async () => {
        if (!roomId || isDeletingRoom) return;

        setIsDeletingRoom(true);

        try {
            const result = await deleteRoom(roomId);

            if (result) throw result;
            startNavigationProgress();
            router.push("/mine");
        } catch (error) {
            setIsDeletingRoom(false);
            throw error;
        }
    };

    const handleExportWords = async () => {
        setExportError("");
        try {
            const jsonData = exportAnswerPairs(items ?? []);
            await navigator.clipboard.writeText(jsonData);
            setIsExported(true);
            setTimeout(() => {
                setIsExported(false);
            }, 3000);
        } catch (error) {
            setExportError(
                error instanceof Error
                    ? error.message
                    : "JSONのエクスポートに失敗しました。",
            );
        }
    };

    const handleImportWords = async () => {
        posthog.capture("words_imported_and_added", { room_id: roomId });

        setImportError("");

        if (!roomId || items === null) return;

        if (!importData.trim()) {
            setImportError("JSONまたはCSVデータを入力してください。");
            return;
        }

        let importedItems: TypedRecallItem[];

        try {
            importedItems = parseImportedWords(importData).map((word) => ({
                id: crypto.randomUUID(),
                type: "typed_recall",
                prompt: word.jp,
                answer: word.en,
            }));
        } catch (error) {
            setImportError(
                error instanceof Error
                    ? error.message
                    : "JSONまたはCSVの形式が正しくありません。",
            );
            return;
        }

        const newItems = [...importedItems, ...items];
        setItems(newItems);

        setImportData("");
        setShowImportInput(false);
    };

    const openVisibilitySettings = () => {
        setVisibilitySelection(roomVisibility);
        setNewPassword("");
        setConfirmPassword("");
        setVisibilityError("");
        setShowVisibilitySettings(true);
    };

    const handleVisibilityUpdate = async () => {
        setVisibilityError("");

        if (!roomId) {
            console.error("Room ID is required.");
            return;
        }

        const isPrivate = visibilitySelection === "private";
        const shouldSetPassword = isPrivate && Boolean(newPassword.trim());

        if (isPrivate && roomVisibility !== "private" && !shouldSetPassword) {
            setVisibilityError(
                "非公開にするにはパスワードを入力してください。",
            );
            return;
        }

        if (shouldSetPassword && newPassword !== confirmPassword) {
            setVisibilityError("パスワードが一致しません。");
            return;
        }

        const request: Room = {
            id: roomId,
            visibility: visibilitySelection,
            ...(shouldSetPassword
                ? { password: newPassword }
                : isPrivate
                  ? {}
                  : { password: null }),
        };

        setIsUpdatingVisibilitySettings(true);
        try {
            // Share the queue/version with auto-save to avoid conflicts with ourselves.
            const attempt = saveQueueRef.current.then(() =>
                isLoadedRef.current
                    ? updateRoomFromId(request, editVersionRef.current)
                    : Promise.resolve({
                          status: "error" as const,
                          message: "最新情報の確認が必要です。",
                      }),
            );
            saveQueueRef.current = attempt.then(
                () => {},
                () => {},
            );
            const result = await attempt;

            if (result.status === "conflict") {
                await refreshRoomData();
                setVisibilityError(
                    "ほかの場所で更新されました。内容を確認してもう一度保存してください。",
                );
                return;
            }

            if (result.status === "error") {
                setVisibilityError(result.message);
                return;
            }

            editVersionRef.current = result.editVersion;
            posthog.capture("room_visibility_changed", {
                room_id: roomId,
                is_private: isPrivate,
                is_public: visibilitySelection === "public",
                visibility: visibilitySelection,
            });

            setRoomVisibility(visibilitySelection);
            setShowVisibilitySettings(false);
        } catch (error) {
            console.error("Failed to update room visibility:", error);
            setVisibilityError(
                "公開設定を保存できませんでした。もう一度お試しください。",
            );
        } finally {
            setIsUpdatingVisibilitySettings(false);
        }
    };

    const saveRoomData = useCallback((): Promise<boolean> => {
        const snapshot = { ...roomDataRef.current };
        const generation = saveGenerationRef.current;
        const attempt = saveQueueRef.current.then(async () => {
            const {
                roomId,
                roomTitle,
                roomExplanation,
                maxPlayers,
                gameDuration,
                bombCount,
                items,
                roomLink,
            } = snapshot;
            if (
                !roomId ||
                !items ||
                !isLoadedRef.current ||
                generation !== saveGenerationRef.current ||
                sameEditorSnapshot(snapshot, syncedSnapshotRef.current)
            ) {
                return false;
            }

            try {
                const existingRoomId = validateLink(roomLink)
                    ? null
                    : await getRoomFromLink(roomLink);
                if (
                    !isLoadedRef.current ||
                    generation !== saveGenerationRef.current
                ) {
                    return false;
                }

                const updatedRoom = validRoomUpdate({
                    id: roomId,
                    title: roomTitle,
                    explanation: roomExplanation,
                    maxPlayers: Number(maxPlayers),
                    gameDuration: Number(gameDuration),
                    bombCount,
                    items,
                    link:
                        existingRoomId && existingRoomId !== roomId
                            ? undefined
                            : roomLink,
                });
                const persistedSnapshot = snapshotFromRoom({
                    title: syncedSnapshotRef.current.roomTitle,
                    explanation: syncedSnapshotRef.current.roomExplanation,
                    maxPlayers: Number(syncedSnapshotRef.current.maxPlayers),
                    gameDuration: syncedSnapshotRef.current.gameDuration,
                    bombCount: syncedSnapshotRef.current.bombCount,
                    items: syncedSnapshotRef.current.items ?? [],
                    link: syncedSnapshotRef.current.roomLink,
                    ...updatedRoom,
                });
                if (
                    sameEditorSnapshot(
                        persistedSnapshot,
                        syncedSnapshotRef.current,
                    )
                )
                    return true;
                const result = await updateRoomFromId(
                    updatedRoom,
                    editVersionRef.current,
                );
                if (result.status === "conflict") {
                    await refreshRoomData();
                    return false;
                }
                if (result.status === "error") {
                    console.error("Failed to save room:", result.message);
                    return false;
                }

                if (generation !== saveGenerationRef.current) {
                    // A navigation/refresh happened while the write was in flight.
                    void refreshRoomData();
                    return false;
                }

                editVersionRef.current = result.editVersion;
                syncedSnapshotRef.current = persistedSnapshot;
                // Another edit may have happened while this save was in flight.
                // Recheck the current form against the newly persisted baseline.
                setSyncRevision((revision) => revision + 1);
                if (persistedSnapshot.roomLink !== savedRouteLinkRef.current) {
                    savedRouteLinkRef.current = persistedSnapshot.roomLink;
                    router.replace("/" + persistedSnapshot.roomLink + "/edit");
                }
                return true;
            } catch (error) {
                console.error("Failed to save room:", error);
                return false;
            }
        });
        saveQueueRef.current = attempt.then(
            () => {},
            () => {},
        );
        return attempt;
    }, [refreshRoomData, router]);

    const handlePlay = async () => {
        startNavigationProgress();
        router.push("/" + roomLink);
    };

    useEffect(() => {
        if (
            !isLoadedRef.current ||
            !roomId ||
            items === null ||
            sameEditorSnapshot(roomDataRef.current, syncedSnapshotRef.current)
        )
            return;

        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = setTimeout(() => {
            if (maxSaveTimerRef.current) {
                clearTimeout(maxSaveTimerRef.current);
                maxSaveTimerRef.current = null;
            }
            void saveRoomData();
        }, 1000);

        if (!maxSaveTimerRef.current) {
            maxSaveTimerRef.current = setTimeout(() => {
                if (saveTimerRef.current) {
                    clearTimeout(saveTimerRef.current);
                    saveTimerRef.current = null;
                }
                maxSaveTimerRef.current = null;
                saveRoomData();
            }, 8000);
        }
    }, [
        roomTitle,
        roomExplanation,
        maxPlayers,
        gameDuration,
        bombCount,
        items,
        roomId,
        roomLink,
        syncRevision,
        saveRoomData,
    ]);

    useEffect(() => {
        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
            if (maxSaveTimerRef.current) {
                clearTimeout(maxSaveTimerRef.current);
            }
        };
    }, []);

    return (
        <Shell
            sidebar={<RoomNavigation isSignedIn={true} />}
            animateAppear={true}
            className="flex flex-col px-4 gap-4"
            size="large"
        >
            {editorSyncError && (
                <div
                    className="flex items-center gap-3 text-sm text-red-500"
                    role="alert"
                >
                    <span data-cursor="text">{editorSyncError}</span>
                    <Button
                        padding="small"
                        onClick={() => {
                            const pending = pendingLatestRoomRef.current;
                            if (pending) {
                                ++saveGenerationRef.current;
                                applyLatestRoom(pending);
                            } else {
                                void refreshRoomData();
                            }
                        }}
                    >
                        最新を読み込む
                    </Button>
                </div>
            )}
            <div className="flex mb-8 items-center w-full">
                <Button
                    variant="text"
                    iconName="arrowLeft"
                    padding="small"
                    href={`/${roomLink}`}
                />
                <Button
                    variant="text"
                    iconName={
                        roomVisibility === "public"
                            ? "earth"
                            : roomVisibility === "unlisted"
                              ? "link"
                              : "lock"
                    }
                    padding="small"
                    onClick={openVisibilitySettings}
                />
                <input
                    className="w-full outline-none text-2xl font-bold font-mono"
                    value={roomTitle}
                    placeholder="ルーム名"
                    data-cursor="text"
                    onChange={(e) => setRoomTitle(e.target.value)}
                />
            </div>
            {validateTitle(roomTitle) && (
                <div className="text-red-500" data-cursor="text">
                    {validateTitle(roomTitle)}
                </div>
            )}

            <div data-cursor="text" className="font-bold flex w-fit text-lg">
                一般
            </div>

            <div className="grid w-full grid-cols-1 gap-4 min-[360px]:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-start">
                <div className="min-w-0 min-[360px]:col-span-2 lg:col-span-1">
                    <Input
                        onChange={(e) => setRoomExplanation(e.target.value)}
                        label="説明"
                        value={roomExplanation}
                    />
                </div>
                <Picker
                    name="最大プレイヤー数"
                    labelPrefix="上限"
                    selection={Math.max(0, Number(maxPlayers) - 2)}
                    items={Array.from(
                        { length: 15 },
                        (_, index) => `${index + 2}人`,
                    )}
                    itemIcons={Array(15).fill(null)}
                    onSelected={(index) => {
                        const nextMax = index + 2;
                        setMaxPlayers(String(nextMax));
                        setBombCount((current) =>
                            current === null
                                ? null
                                : Math.min(current, nextMax, 4),
                        );
                    }}
                />
                <Picker
                    name="爆弾数"
                    labelPrefix="爆弾"
                    selection={bombCount ?? 0}
                    items={[
                        "自動",
                        ...Array.from(
                            { length: Math.min(Number(maxPlayers), 4) },
                            (_, index) => `${index + 1}個`,
                        ),
                    ]}
                    itemIcons={Array(Math.min(Number(maxPlayers), 4) + 1).fill(
                        null,
                    )}
                    onSelected={(index) =>
                        setBombCount(index === 0 ? null : index)
                    }
                />
                <Picker
                    name="ゲーム時間"
                    labelPrefix="時間"
                    selection={(gameDuration ?? 0) / 10 - 1}
                    items={["1分", "2分", "3分"]}
                    itemIcons={[null, null, null]}
                    onSelected={(index) => setGameDuration(index * 10 + 10)}
                />
                {validateExplanation(roomExplanation) && (
                    <div
                        className="text-red-500 min-[360px]:col-span-2 lg:col-span-4"
                        data-cursor="text"
                    >
                        {validateExplanation(roomExplanation)}
                    </div>
                )}
            </div>

            <div className="flex gap-4 w-full">
                <div className="w-full flex flex-col gap-4">
                    <Input
                        onChange={(e) => setRoomLink(e.target.value)}
                        label="リンク"
                        font="mono"
                        type="url"
                        inputClassName="pl-7.5"
                        className={`transition-all w-full duration-(--duration-etb) ease-etb`}
                        value={roomLink}
                        disableLabelAnimation={true}
                    >
                        <div className="font-mono opacity-50 absolute top-4 left-5 pointer-events-none">
                            /
                        </div>
                    </Input>
                    {validateLink(roomLink) && (
                        <div className="text-red-500" data-cursor="text">
                            {validateLink(roomLink)}
                        </div>
                    )}
                </div>

                <div className="w-16">
                    <MorphDialog
                        button={
                            <Button
                                className="w-fit shrink-0"
                                onClick={() => {
                                    if (items && items.length !== 0)
                                        void handlePlay();
                                    else setShowPlayWarning(true);
                                }}
                                variant="primary"
                                padding="large"
                                iconName="play"
                            />
                        }
                        open={showPlayWarning}
                        onClose={() => setShowPlayWarning(false)}
                        title="ルームに単語がありません"
                        description="ゲームをプレイするためには、ルームに最低でも1つの単語が必要です。"
                        alignment="vertical"
                    >
                        <Button
                            onClick={() => handlePlay()}
                            iconName="play"
                            variant="primary"
                            className="w-full"
                        >
                            プレイ
                        </Button>
                        <Button
                            onClick={() => setShowPlayWarning(false)}
                            iconName="x"
                            className="w-full"
                        >
                            キャンセル
                        </Button>
                    </MorphDialog>
                </div>
            </div>

            <div
                data-cursor="text"
                className="font-bold flex w-fit text-lg mt-4"
            >
                設定
            </div>

            <div className="w-full grid gap-4 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
                <MorphDialog
                    button={
                        <Button
                            onClick={openVisibilitySettings}
                            className="w-full"
                            iconName="eye"
                        >
                            公開設定
                        </Button>
                    }
                    title="公開設定"
                    open={showVisibilitySettings}
                    alignment="vertical"
                    size="middle"
                    onClose={() => setShowVisibilitySettings(false)}
                >
                    <Selection
                        items={["公開", "限定公開", "非公開"]}
                        selection={VISIBILITY_OPTIONS.indexOf(
                            visibilitySelection,
                        )}
                        onSelected={(index) => {
                            setVisibilitySelection(
                                VISIBILITY_OPTIONS[index] ?? "unlisted",
                            );
                            setVisibilityError("");

                            if (index !== 2) {
                                setNewPassword("");
                                setConfirmPassword("");
                            }
                        }}
                    />

                    <Input
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        label="パスワード"
                        type="password"
                        disabled={visibilitySelection !== "private"}
                    />
                    <Input
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        label="パスワードの確認"
                        type="password"
                        disabled={visibilitySelection !== "private"}
                    />

                    <div className="flex gap-4 w-full">
                        <Button
                            className="w-full"
                            onClick={() => setShowVisibilitySettings(false)}
                            iconName="x"
                        >
                            キャンセル
                        </Button>
                        <Button
                            variant="primary"
                            onClick={() => handleVisibilityUpdate()}
                            className="w-full"
                            iconName="check"
                            loading={isUpdatingVisibilitySettings}
                        >
                            完了
                        </Button>
                    </div>
                    {visibilityError && (
                        <div className="text-red-500" data-cursor="text">
                            {visibilityError}
                        </div>
                    )}
                </MorphDialog>

                <Button
                    onClick={() => handleExportWords()}
                    className=""
                    iconName={isExported ? "check" : "download"}
                >
                    {!isExported && "エクスポート"}
                </Button>
                {exportError && (
                    <div className="text-red-500" role="alert">
                        {exportError}
                    </div>
                )}

                <MorphDialog
                    button={
                        <Button
                            onClick={() => setShowDeleteDialog(true)}
                            variant="danger"
                            className=""
                            iconName="trash"
                        >
                            ルームを削除
                        </Button>
                    }
                    title="本当にこのルームを削除しますか？"
                    description="この操作は取り消すことができません。"
                    open={showDeleteDialog}
                    alignment="vertical"
                    onClose={() => setShowDeleteDialog(false)}
                >
                    <Button
                        variant="danger"
                        iconName="trash"
                        className="w-full"
                        onClick={() => handleDeleteRoom()}
                        loading={isDeletingRoom}
                    >
                        削除
                    </Button>
                    <Button
                        iconName="x"
                        className="w-full"
                        onClick={() => setShowDeleteDialog(false)}
                    >
                        キャンセル
                    </Button>
                </MorphDialog>
            </div>

            <div
                data-cursor="text"
                className="font-bold flex w-fit text-lg mt-4"
            >
                単語
            </div>

            {items && (
                <div className="w-full flex gap-4">
                    <Button
                        onClick={() => {
                            setShowImportInput(false);
                            setItems([
                                {
                                    id: crypto.randomUUID(),
                                    type: "typed_recall",
                                    prompt: "",
                                    answer: "",
                                },
                                ...items,
                            ]);

                            posthog.capture("word_added");
                        }}
                        className="w-full"
                        iconName="plus"
                    >
                        追加
                    </Button>

                    <Button
                        onClick={() => {
                            setShowGenerationInput(!showGenerationInput);
                            setGenerationPrompt("");
                            setGenerationError("");
                            setGeneratedWords([]);
                            setShowImportInput(false);
                        }}
                        disabled={isGeminiUsageLoading || isGeminiLimitReached}
                        iconName="wandSparkles"
                    />

                    <Button
                        onClick={() => {
                            setImportError("");
                            setImportData("");
                            setShowImportInput(!showImportInput);
                            setShowGenerationInput(false);
                        }}
                        iconName="upload"
                    />
                    <Dialog
                        title="単語のインポート"
                        size="middle"
                        alignment="vertical"
                        open={showImportDialog}
                        onClose={() => setShowImportDialog(false)}
                    >
                        <div className="w-full px-2 flex flex-col items-start gap-4">
                            <div data-cursor="text">
                                JSONは、問題文をキー、回答を値にした1つのオブジェクトで貼り付けてください:
                            </div>
                            <div data-cursor="text">
                                {" "}
                                <pre className="text-sm">
                                    {`{\n    "ねこ": "cat",\n    "日本の憲法の名前は？": "にほんこくけんぽう"\n}`}
                                </pre>
                            </div>
                            <div data-cursor="text">
                                CSVはヘッダーなしの2列で貼り付けてください:
                            </div>
                            <pre className="text-sm" data-cursor="text">
                                {
                                    "りんご,apple\n日本の憲法の名前は？,にほんこくけんぽう"
                                }
                            </pre>
                        </div>
                        <Button
                            onClick={() => setShowImportDialog(false)}
                            variant="primary"
                            className="w-full"
                            iconName="check"
                        >
                            完了
                        </Button>
                    </Dialog>
                </div>
            )}

            {items && (
                <div className="flex flex-col">
                    <Collapsible
                        open={showGenerationInput}
                        className={`flex z-2 ${showGenerationInput ? "mb-4" : "scale-y-0 py-0 opacity-0 blur-md pointer-events-none"} flex-col rounded-3xl sm:-mx-4 bg-(--color-background) gap-4 origin-top ease-etb transition-all duration-(--duration-etb)`}
                        childrenClassName="flex p-4 flex-col gap-4 items-center"
                    >
                        <div className="flex gap-4 w-full">
                            <Input
                                value={generationPrompt}
                                label="テーマ"
                                onChange={(e) =>
                                    setGenerationPrompt(e.target.value)
                                }
                                className="w-full"
                            />
                            <Button
                                loading={isGenerating}
                                disabled={!generationPrompt}
                                onClick={async () => {
                                    setIsGenerating(true);
                                    setGenerationError("");

                                    try {
                                        const generatedWords =
                                            await generateWordsAction(
                                                generationPrompt,
                                            );

                                        if ("error" in generatedWords) {
                                            setGeneratedWords([]);
                                            setGenerationError(
                                                generatedWords.error,
                                            );
                                        } else {
                                            setGeneratedWords(
                                                generatedWords.words,
                                            );
                                        }
                                    } catch (error) {
                                        console.error(
                                            "Failed to generate words:",
                                            error,
                                        );

                                        setGeneratedWords([]);
                                        setGenerationError(
                                            "単語の生成に失敗しました。もう一度お試しください。",
                                        );
                                    } finally {
                                        setIsGenerating(false);
                                        await refreshGeminiUsage();
                                    }
                                }}
                                iconName="arrowRight"
                                variant="primary"
                                padding="large"
                            />
                        </div>

                        {generatedWords.length !== 0 && (
                            <div
                                className={`grid gap-4 grid-cols-[repeat(auto-fit,minmax(256px,1fr))] origin-top w-full animate-appear transition-all ease-etb duration-(--duration-etb)`}
                            >
                                {generatedWords.map((word, index) => (
                                    <div
                                        data-cursor="text"
                                        className="truncate rounded-lg bg-(--color-background-secondary) py-1 px-2"
                                        key={index}
                                    >
                                        {word.jp}
                                        <div className="w-full font-mono">
                                            {word.en}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {generatedWords?.length !== 0 && (
                            <div className="flex gap-4 w-full">
                                <Button
                                    onClick={() =>
                                        setShowGenerationInput(false)
                                    }
                                    className="w-full animate-appear"
                                    iconName="x"
                                >
                                    キャンセル
                                </Button>
                                <Button
                                    variant="primary"
                                    className="w-full animate-appear"
                                    iconName="plus"
                                    onClick={() => {
                                        if (!generatedWords) return;

                                        const generatedItems: TypedRecallItem[] =
                                            generatedWords.map((word) => ({
                                                id: crypto.randomUUID(),
                                                type: "typed_recall",
                                                prompt: word.jp,
                                                answer: word.en,
                                            }));

                                        setItems([...generatedItems, ...items]);
                                        setShowGenerationInput(false);
                                    }}
                                >
                                    追加
                                </Button>
                            </div>
                        )}

                        {generationError && (
                            <div className="text-red-500" data-cursor="text">
                                {generationError}
                            </div>
                        )}
                    </Collapsible>
                    <Collapsible
                        open={showImportInput}
                        className={`flex z-2 ${showImportInput ? "mb-4" : "scale-y-0 py-0 opacity-0 blur-md pointer-events-none"} flex-col rounded-3xl sm:-mx-4 bg-(--color-background) gap-4 origin-top ease-etb transition-all duration-(--duration-etb)`}
                        childrenClassName="flex p-4 flex-col gap-4 items-center"
                    >
                        <div data-cursor="text" className="p-2">
                            単語は2列のCSV、または問題と回答のペアを並べたJSONで貼り付けてください。
                            <Button
                                onClick={() => setShowImportDialog(true)}
                                variant="text"
                            >
                                詳しく見る
                            </Button>
                        </div>
                        <Input
                            value={importData}
                            variant="textarea"
                            inputClassName="resize-none h-48"
                            font="mono"
                            onChange={(e) => setImportData(e.target.value)}
                            label="単語データ"
                        />
                        {importData && (
                            <div className="w-full animate-appear grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                                <Button
                                    onClick={() => setShowImportInput(false)}
                                    className="w-full"
                                    iconName="x"
                                >
                                    キャンセル
                                </Button>
                                <Button
                                    variant="primary"
                                    className="w-full"
                                    iconName="plus"
                                    onClick={() => handleImportWords()}
                                >
                                    インポート
                                </Button>
                            </div>
                        )}
                        {importError && (
                            <div className="text-red-500" data-cursor="text">
                                {importError}
                            </div>
                        )}
                    </Collapsible>
                    <div ref={itemListRef} className="flex flex-col gap-4">
                        <DndContext
                            sensors={sensors}
                            modifiers={[restrictWordDrag]}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={items.map((item) => item.id)}
                                strategy={verticalListSortingStrategy}
                            >
                                {items.map((item, index) => (
                                    <SortableItem key={item.id} id={item.id}>
                                        <div className="flex items-center gap-4 w-full">
                                            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] w-full">
                                                <div className="flex flex-col gap-4">
                                                    <Input
                                                        label="問題"
                                                        font="mono"
                                                        value={item.prompt}
                                                        onChange={(e) => {
                                                            const newItems =
                                                                items.map(
                                                                    (
                                                                        currentItem,
                                                                        itemIndex,
                                                                    ) =>
                                                                        itemIndex ===
                                                                        index
                                                                            ? {
                                                                                  ...currentItem,
                                                                                  prompt: e
                                                                                      .target
                                                                                      .value,
                                                                              }
                                                                            : currentItem,
                                                                );
                                                            setItems(newItems);
                                                        }}
                                                    />
                                                    {item.prompt.length >
                                                        32 && (
                                                        <div
                                                            className="text-red-500"
                                                            data-cursor="text"
                                                        >
                                                            32文字以内で入力してください。
                                                        </div>
                                                    )}
                                                    {!item.prompt && (
                                                        <div
                                                            className="text-red-500"
                                                            data-cursor="text"
                                                        >
                                                            この項目は必須です。
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-4">
                                                    <Input
                                                        label="回答"
                                                        font="mono"
                                                        value={item.answer}
                                                        onChange={(e) => {
                                                            const newItems =
                                                                items.map(
                                                                    (
                                                                        currentItem,
                                                                        itemIndex,
                                                                    ) =>
                                                                        itemIndex ===
                                                                        index
                                                                            ? {
                                                                                  ...currentItem,
                                                                                  answer: e
                                                                                      .target
                                                                                      .value,
                                                                              }
                                                                            : currentItem,
                                                                );
                                                            setItems(newItems);
                                                        }}
                                                    />
                                                    {!item.answer.trim() && (
                                                        <div
                                                            className="text-red-500"
                                                            data-cursor="text"
                                                        >
                                                            この項目は必須です。
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div>
                                                <Button
                                                    onClick={() => {
                                                        const newItems =
                                                            items.filter(
                                                                (
                                                                    _,
                                                                    itemIndex,
                                                                ) =>
                                                                    itemIndex !==
                                                                    index,
                                                            );
                                                        setItems(newItems);
                                                    }}
                                                    className="h-fit"
                                                    padding="large"
                                                    iconName="trash"
                                                />
                                            </div>
                                        </div>
                                    </SortableItem>
                                ))}
                            </SortableContext>
                        </DndContext>
                    </div>
                </div>
            )}

            <div
                className={`fixed z-1 inset-0 flex items-center justify-center ${!(showImportInput || showGenerationInput) && "opacity-0 pointer-events-none scale-105"} transition-all duration-(--duration-etb) ease-etb`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="dialog-title"
                aria-describedby={
                    showImportInput || showGenerationInput
                        ? "dialog-description"
                        : undefined
                }
            >
                <button
                    type="button"
                    aria-label="ダイアログを閉じる"
                    onClick={() => {
                        setShowImportInput(false);
                        setShowGenerationInput(false);
                    }}
                    className={`absolute inset-0 cursor-default ${(showImportInput || showGenerationInput) && "bg-(--color-background-secondary)/50"} transition-all duration-(--duration-etb) ease-etb`}
                />
            </div>
        </Shell>
    );
}
