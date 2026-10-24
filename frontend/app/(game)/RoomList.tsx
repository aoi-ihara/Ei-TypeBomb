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
import Picker from "@/components/ui/Picker";
import Image from "next/image";

type CurrentUser = {
    id: string;
    email: string | null;
    displayName: string | null;
};

type Props = {
    publicRooms: Room[];
    myRooms: Room[];
    initialView: "public" | "me";
    currentUser: CurrentUser | null;
    initialBackgroundMusic: boolean;
    initialSoundEffects: boolean;
};

type CreatorFilter = "all" | "mine" | "others";
type VisibilityFilter = "all" | "public" | "private";
type ItemCountFilter =
    | "all"
    | "empty"
    | "1-9"
    | "10-19"
    | "20-39"
    | "40-59"
    | "60-79"
    | "80-99"
    | "100+";

const CREATOR_FILTERS: CreatorFilter[] = ["all", "mine", "others"];
const CREATOR_FILTER_ITEMS = ["すべて", "自分", "自分以外"];
const VISIBILITY_FILTERS: VisibilityFilter[] = ["all", "public", "private"];
const VISIBILITY_FILTER_ITEMS = ["すべて", "公開", "非公開"];
const ITEM_COUNT_FILTERS: ItemCountFilter[] = [
    "all",
    "empty",
    "1-9",
    "10-19",
    "20-39",
    "40-59",
    "60-79",
    "80-99",
    "100+",
];
const ITEM_COUNT_FILTER_ITEMS = [
    "すべて",
    "0",
    "1〜9",
    "10〜19",
    "20〜39",
    "40〜59",
    "60〜79",
    "80〜99",
    "100以上",
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
    const [keyword, setKeyword] = useState("");
    const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>(
        initialView === "me" ? "mine" : "all",
    );
    const [visibilityFilter, setVisibilityFilter] =
        useState<VisibilityFilter>(
            initialView === "me" ? "all" : "public",
        );
    const [itemCountFilter, setItemCountFilter] =
        useState<ItemCountFilter>("all");

    const rooms = useMemo(() => {
        // Show every public room plus the current user's private rooms.
        // Merge by ID so the owner's copy wins and retains its edit metadata.
        const roomsById = new Map<string, Room>();
        for (const room of publicRooms) roomsById.set(room.id, room);
        for (const room of myRooms) {
            roomsById.set(room.id, {
                ...room,
                userId: room.userId ?? currentUser?.id,
            });
        }
        return Array.from(roomsById.values());
    }, [publicRooms, myRooms, currentUser?.id]);

    const normalizeListUrl = () => {
        // Query parameters initialize the list when navigating from elsewhere.
        // Once an in-page control is used, keep the URL at "/".
        if (window.location.pathname === "/" && window.location.search) {
            window.history.replaceState(window.history.state, "", "/");
        }
    };

    const selectView = (nextView: "public" | "me") => {
        if (nextView === "me" && !currentUser) {
            router.push(getSignInUrl());
            return;
        }

        setCreatorFilter(nextView === "me" ? "mine" : "all");
        setVisibilityFilter(nextView === "me" ? "all" : "public");
        setItemCountFilter("all");
        setKeyword("");
        normalizeListUrl();
    };

    useEffect(() => {
        if (!currentUser) return;
        posthog.identify(currentUser.id, {
            email: currentUser.email,
            display_name: currentUser.displayName,
        });
    }, [currentUser]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    // Keep in-page filter state in sync when another page navigates to
    // "/?filter=mine" or "/?filter=public".
    useEffect(() => {
        if (initialView === "me") {
            setCreatorFilter("mine");
            setVisibilityFilter("all");
        } else {
            setCreatorFilter("all");
            setVisibilityFilter("public");
        }
        setItemCountFilter("all");
        setKeyword("");
    }, [initialView]);

    const filteredRooms = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLocaleLowerCase();

        return rooms
            .filter((room) => {
                if (normalizedKeyword) {
                    const searchableText = [
                        room.title,
                        room.explanation,
                        room.id,
                    ]
                        .filter(Boolean)
                        .join(" ")
                        .toLocaleLowerCase();
                    if (!searchableText.includes(normalizedKeyword)) {
                        return false;
                    }
                }

                const isOwner =
                    Boolean(currentUser) && room.userId === currentUser?.id;
                if (creatorFilter === "mine" && !isOwner) return false;
                if (creatorFilter === "others" && isOwner) return false;

                if (visibilityFilter === "public" && !room.isPublic) {
                    return false;
                }
                if (
                    visibilityFilter === "private" &&
                    (room.isPublic !== false || !isOwner)
                ) {
                    return false;
                }

                const itemCount =
                    room.itemCount ?? room.items?.length ?? 0;
                switch (itemCountFilter) {
                    case "empty":
                        if (itemCount !== 0) return false;
                        break;
                    case "1-9":
                        if (itemCount < 1 || itemCount > 9) return false;
                        break;
                    case "10-19":
                        if (itemCount < 10 || itemCount > 19) return false;
                        break;
                    case "20-39":
                        if (itemCount < 20 || itemCount > 39) return false;
                        break;
                    case "40-59":
                        if (itemCount < 40 || itemCount > 59) return false;
                        break;
                    case "60-79":
                        if (itemCount < 60 || itemCount > 79) return false;
                        break;
                    case "80-99":
                        if (itemCount < 80 || itemCount > 99) return false;
                        break;
                    case "100+":
                        if (itemCount < 100) return false;
                        break;
                    case "all":
                        break;
                }

                return true;
            })
            .sort(
                (a, b) =>
                    new Date(b.updatedAt ?? 0).getTime() -
                    new Date(a.updatedAt ?? 0).getTime(),
            );
    }, [
        rooms,
        keyword,
        creatorFilter,
        visibilityFilter,
        itemCountFilter,
        currentUser?.id,
    ]);

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
                                onClick: () => selectView("me"),
                            },
                            {
                                label: "ユーザー設定",
                                icon: "userRoundCog",
                                onClick: () =>
                                    router.push(
                                        process.env
                                            .NEXT_PUBLIC_USER_SETTINGS_URL!,
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

            <Shell size="large">
                <Button
                    onClick={addRoom}
                    loading={creating}
                    iconName="plus"
                    className="shrink-0 w-full"
                >
                    新規
                </Button>

                <div className="flex w-full gap-4">
                    <Input
                        value={keyword}
                        label="キーワード検索"
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            normalizeListUrl();
                        }}
                        autoComplete="off"
                    />
                </div>

                <div className="grid gap-4 w-full grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                    <Picker
                        name="作成者"
                        labelPrefix="作成者"
                        selection={CREATOR_FILTERS.indexOf(creatorFilter)}
                        items={CREATOR_FILTER_ITEMS}
                        itemIcons={[null, null, null]}
                        onSelected={(index) => {
                            const nextFilter = CREATOR_FILTERS[index];
                            if (nextFilter === "mine" && !currentUser) {
                                router.push(getSignInUrl());
                                return;
                            }
                            setCreatorFilter(nextFilter);
                            normalizeListUrl();
                        }}
                    />
                    <Picker
                        name="公開設定"
                        labelPrefix="公開設定"
                        selection={VISIBILITY_FILTERS.indexOf(
                            visibilityFilter,
                        )}
                        items={VISIBILITY_FILTER_ITEMS}
                        itemIcons={[null, null, null]}
                        onSelected={(index) => {
                            const nextFilter = VISIBILITY_FILTERS[index];
                            if (nextFilter === "private" && !currentUser) {
                                router.push(getSignInUrl());
                                return;
                            }
                            setVisibilityFilter(nextFilter);
                            normalizeListUrl();
                        }}
                    />
                    <Picker
                        name="問題数"
                        labelPrefix="問題数"
                        selection={ITEM_COUNT_FILTERS.indexOf(itemCountFilter)}
                        items={ITEM_COUNT_FILTER_ITEMS}
                        itemIcons={ITEM_COUNT_FILTER_ITEMS.map(() => null)}
                        onSelected={(index) => {
                            setItemCountFilter(ITEM_COUNT_FILTERS[index]);
                            normalizeListUrl();
                        }}
                    />
                </div>

                {createError && (
                    <p className="text-red-500" role="alert">
                        {createError}
                    </p>
                )}

                {filteredRooms.length > 0 ? (
                    <div className="grid w-full gap-4 sm:grid-cols-2">
                        {filteredRooms.map((room) => (
                            <RoomCard
                                key={room.id}
                                room={room}
                                isOwner={
                                    Boolean(currentUser) &&
                                    room.userId === currentUser?.id
                                }
                            />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-xl bg-(--color-background-secondary) px-6 py-12 text-center">
                        <p className="font-semibold">
                            {rooms.length === 0
                                ? initialView === "me"
                                    ? "まだルームがありません"
                                    : "共有されているルームはありません"
                                : "条件に一致するルームがありません"}
                        </p>
                        <p className="mt-2 text-sm opacity-60">
                            {rooms.length === 0
                                ? initialView === "me"
                                    ? "ルームを作成して、単語リストを準備しましょう。"
                                    : "公開されたルームがここに表示されます。"
                                : "キーワードやフィルタを変更してみてください。"}
                        </p>
                    </div>
                )}
            </Shell>
        </>
    );
}
