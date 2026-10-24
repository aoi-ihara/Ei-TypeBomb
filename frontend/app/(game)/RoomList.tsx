"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Room } from "@/type";
import RoomCard from "@/components/ui/RoomCard";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import MorphDialog from "@/components/ui/MorphDialog";
import { createNewRoom } from "@/lib/room/create";
import { getSignInUrl } from "@/lib/auth/sign-in-url";
import { signOut } from "@/lib/auth/sign-out";
import posthog from "posthog-js";
import Menu from "@/components/ui/Menu";
import Shell from "@/components/layout/Shell";
import Input from "@/components/ui/Input";
import Image from "next/image";

type CurrentUser = {
    id: string;
    email: string | null;
    displayName: string | null;
};

type View = "recommended" | "mine" | "saved";

type Props = {
    publicRooms: Room[];
    myRooms: Room[];
    initialView: "public" | "me";
    currentUser: CurrentUser | null;
    initialBackgroundMusic: boolean;
    initialSoundEffects: boolean;
};

const SAVED_ROOMS_STORAGE_KEY = "ei-typebomb:saved-rooms:v1";

const navigationItems: {
    value: View;
    label: string;
    iconName: "wandSparkles" | "layoutGrid" | "archive";
}[] = [
    { value: "recommended", label: "おすすめ", iconName: "wandSparkles" },
    { value: "mine", label: "自分のルーム", iconName: "layoutGrid" },
    { value: "saved", label: "保存", iconName: "archive" },
];

export default function RoomList({
    publicRooms,
    myRooms,
    initialView,
    currentUser,
    initialBackgroundMusic,
    initialSoundEffects,
}: Props) {
    const router = useRouter();
    const [creating, setCreating] = useState(false);
    const [showCursor, setShowCursor] = useState(true);
    const [createError, setCreateError] = useState("");
    const [showSettings, setShowSettings] = useState(false);
    const [backgroundMusic, setBackgroundMusic] = useState(
        initialBackgroundMusic,
    );
    const [soundEffects, setSoundEffects] = useState(initialSoundEffects);
    const [view, setView] = useState<View>(
        initialView === "me" ? "mine" : "recommended",
    );
    const [keyword, setKeyword] = useState("");
    const [savedRoomIds, setSavedRoomIds] = useState<string[]>([]);

    const rooms = useMemo(() => {
        const roomsById = new Map<string, Room>();

        for (const room of publicRooms) {
            roomsById.set(room.id, room);
        }

        // Prefer the owner's copy when a room appears in both lists.
        for (const room of myRooms) {
            roomsById.set(room.id, {
                ...room,
                userId: room.userId ?? currentUser?.id,
            });
        }

        return Array.from(roomsById.values()).sort(
            (a, b) =>
                new Date(b.updatedAt ?? 0).getTime() -
                new Date(a.updatedAt ?? 0).getTime(),
        );
    }, [publicRooms, myRooms, currentUser?.id]);

    const myRoomIds = useMemo(
        () => new Set(myRooms.map((room) => room.id)),
        [myRooms],
    );

    const roomsInView = useMemo(() => {
        if (view === "mine") return myRooms;
        if (view === "saved") {
            return rooms.filter((room) => savedRoomIds.includes(room.id));
        }
        return rooms.filter((room) => room.isPublic);
    }, [view, myRooms, rooms, savedRoomIds]);

    const filteredRooms = useMemo(() => {
        const query = keyword.trim().toLowerCase();

        return roomsInView
            .filter((room) => {
                if (!query) return true;

                const searchableText = [
                    room.id,
                    room.title,
                    room.explanation,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();

                return searchableText.includes(query);
            })
            .sort(
                (a, b) =>
                    new Date(b.updatedAt ?? 0).getTime() -
                    new Date(a.updatedAt ?? 0).getTime(),
            );
    }, [roomsInView, keyword]);

    const selectView = (nextView: View) => {
        if (nextView === "mine" && !currentUser) {
            router.push(getSignInUrl());
            return;
        }

        setView(nextView);

        // Keep the old query parameters only for arriving at this page.
        if (window.location.pathname === "/" && window.location.search) {
            window.history.replaceState(window.history.state, "", "/");
        }
    };

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(SAVED_ROOMS_STORAGE_KEY);
            if (!stored) return;

            const parsed: unknown = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                setSavedRoomIds(
                    Array.from(
                        new Set(
                            parsed.filter(
                                (value): value is string =>
                                    typeof value === "string",
                            ),
                        ),
                    ),
                );
            }
        } catch (error) {
            console.error("Failed to load saved rooms:", error);
        }
    }, []);

    const toggleSavedRoom = (roomId: string) => {
        let currentSavedIds = savedRoomIds;

        // Re-read storage to avoid overwriting saved rooms if this is clicked
        // before the initial effect has finished.
        try {
            const stored = window.localStorage.getItem(SAVED_ROOMS_STORAGE_KEY);
            if (stored) {
                const parsed: unknown = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    currentSavedIds = parsed.filter(
                        (value): value is string => typeof value === "string",
                    );
                }
            }
        } catch {
            // Continue with in-memory state if storage is unavailable.
        }

        const wasSaved = currentSavedIds.includes(roomId);
        const nextSavedIds = wasSaved
            ? currentSavedIds.filter((id) => id !== roomId)
            : Array.from(new Set([...currentSavedIds, roomId]));

        setSavedRoomIds(nextSavedIds);

        try {
            window.localStorage.setItem(
                SAVED_ROOMS_STORAGE_KEY,
                JSON.stringify(nextSavedIds),
            );
        } catch (error) {
            console.error("Failed to save room list:", error);
        }

        posthog.capture("room_saved_toggled", {
            room_id: roomId,
            saved: !wasSaved,
        });
    };

    useEffect(() => {
        if (!currentUser) return;
        posthog.identify(currentUser.id, {
            email: currentUser.email,
            display_name: currentUser.displayName,
        });
    }, [currentUser]);

    const setCookie = (key: string, value: boolean) => {
        document.cookie =
            key +
            "=" +
            String(value) +
            "; path=/; max-age=31536000; SameSite=Lax";
    };

    const addRoom = async () => {
        if (creating) return;
        if (!currentUser) {
            router.push(getSignInUrl());
            return;
        }

        setCreating(true);
        setCreateError("");
        try {
            const roomId = await createNewRoom();
            if (!roomId) throw new Error("Room creation returned no ID");
            posthog.capture("room_created");
            router.push("/" + roomId + "/edit");
        } catch (error) {
            console.error("Failed to create room:", error);
            setCreateError(
                "ルームを作成できませんでした。もう一度お試しください。",
            );
            setCreating(false);
        }
    };

    const handleSignOut = async () => {
        posthog.capture("signed_out");
        posthog.reset();
        await signOut();
        router.replace("/");
    };

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    const viewTitle =
        navigationItems.find((item) => item.value === view)?.label ?? "おすすめ";

    return (
        <>
            <header className="w-full flex justify-end p-4 gap-4">
                <div className="w-18">
                    <MorphDialog
                        button={
                            <Button
                                variant="text"
                                onClick={() => setShowSettings(!showSettings)}
                                iconName="settings"
                            >
                                設定
                            </Button>
                        }
                        title="設定"
                        alignment="vertical"
                        open={showSettings}
                        onClose={() => setShowSettings(false)}
                    >
                        <div className="flex w-full items-center justify-between pl-3">
                            <div data-cursor="text">BGM</div>
                            <Toggle
                                checked={backgroundMusic}
                                onChange={(next) => {
                                    setBackgroundMusic(next);
                                    setCookie("background-music", next);
                                    posthog.capture("settings_changed", {
                                        setting: "background_music",
                                        value: next,
                                    });
                                }}
                            />
                        </div>
                        <div className="flex w-full items-center justify-between pl-3">
                            <div data-cursor="text">効果音</div>
                            <Toggle
                                checked={soundEffects}
                                onChange={(next) => {
                                    setSoundEffects(next);
                                    setCookie("sound-effects", next);
                                    posthog.capture("settings_changed", {
                                        setting: "sound_effects",
                                        value: next,
                                    });
                                }}
                            />
                        </div>
                        <Button
                            className="w-full"
                            variant="primary"
                            iconName="check"
                            onClick={() => setShowSettings(false)}
                        >
                            完了
                        </Button>
                    </MorphDialog>
                </div>

                {currentUser ? (
                    <Menu
                        name="ユーザーアクション"
                        button={
                            <Button variant="text" iconName="circleUserRound">
                                ユーザー
                            </Button>
                        }
                        items={[
                            {
                                label: "自分のルーム",
                                icon: "layoutGrid",
                                onClick: () => selectView("mine"),
                            },
                            {
                                label: "ユーザー設定",
                                icon: "userRoundCog",
                                onClick: () =>
                                    router.push(
                                        process.env.NEXT_PUBLIC_USER_SETTINGS_URL!,
                                    ),
                            },
                            {
                                label: "サインアウト",
                                icon: "logOut",
                                onClick: handleSignOut,
                            },
                        ]}
                    />
                ) : (
                    <Button
                        variant="text"
                        onClick={() => router.push(getSignInUrl())}
                    >
                        ログイン
                    </Button>
                )}
            </header>

            <div className="items-center mb-4 rounded-lg overflow-clip">
                <Image
                    src={showCursor ? "/favicon.svg" : "/favicon-2.svg"}
                    alt="page-logo"
                    width={150}
                    height={150}
                />
            </div>

            <Shell
                size="large"
                className="flex flex-col gap-4 items-center max-w-6xl"
            >
                <div className="flex w-full flex-col gap-6 sm:flex-row sm:items-start">
                    <nav
                        aria-label="ルームカテゴリ"
                        className="w-full sm:w-48 flex sm:flex-col shrink-0 no-scrollbar overflow-x-auto gap-2 px-4 -mx-4 sm:px-0 sm:mx-0 sm:overflow-visible"
                    >
                        {navigationItems.map((item) => (
                            <Button
                                key={item.value}
                                className="w-fit shrink-0 sm:w-full"
                                variant={view === item.value ? "primary" : "default"}
                                onClick={() => selectView(item.value)}
                                iconName={item.iconName}
                                alignment="left"
                            >
                                {item.label}
                            </Button>
                        ))}
                    </nav>

                    <main className="flex min-w-0 w-full flex-1 flex-col gap-4">
                        <div className="flex w-full flex-wrap items-center justify-between gap-3">
                            <h1 className="text-2xl font-bold" data-cursor="text">
                                {viewTitle}
                            </h1>
                            <Button
                                onClick={addRoom}
                                loading={creating}
                                iconName="plus"
                                className="w-fit shrink-0"
                            >
                                ルームを作成
                            </Button>
                        </div>

                        <Input
                            value={keyword}
                            onChange={(event) => setKeyword(event.target.value)}
                            label="ルームを検索"
                            autoComplete="off"
                        />

                        {createError && (
                            <p className="text-red-500" role="alert">
                                {createError}
                            </p>
                        )}

                        {filteredRooms.length > 0 ? (
                            <div className="grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                {filteredRooms.map((room) => (
                                    <RoomCard
                                        key={room.id}
                                        room={room}
                                        isOwner={myRoomIds.has(room.id)}
                                        isSaved={savedRoomIds.includes(room.id)}
                                        onToggleSaved={() => toggleSavedRoom(room.id)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-xl bg-(--color-background-secondary) px-6 py-12 text-center">
                                <p className="font-semibold">
                                    {keyword.trim()
                                        ? "検索結果がありません"
                                        : view === "mine"
                                          ? "まだルームがありません"
                                          : view === "saved"
                                            ? "保存したルームはありません"
                                            : "公開ルームはまだありません"}
                                </p>
                                <p className="mt-2 text-sm opacity-60">
                                    {keyword.trim()
                                        ? "別のキーワードで検索してみてください。"
                                        : view === "mine"
                                          ? "ルームを作成して、単語リストを準備しましょう。"
                                          : view === "saved"
                                            ? "気になるルームの「保存」を押すと、ここに表示されます。"
                                            : "公開されたルームがここに表示されます。"}
                                </p>
                            </div>
                        )}
                    </main>
                </div>
            </Shell>
        </>
    );
}
