"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import type { Room } from "@/type";
import RoomCard from "@/components/ui/RoomCard";
import Button from "@/components/ui/Button";
import { createNewRoom } from "@/lib/room/create";
import { getSignInUrl } from "@/lib/auth/sign-in-url";
import { signOut } from "@/lib/auth/sign-out";
import { toggleSavedRoom } from "@/lib/room/save";
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
    initialSavedRoomIds: string[];
};

const getViewFromSearchParams = (searchParams: URLSearchParams): View => {
    const filter = searchParams.get("filter");
    if (filter === "mine") return "mine";
    if (filter === "saved") return "saved";
    return "recommended";
};

export default function RoomList({
    publicRooms,
    myRooms,
    initialView,
    currentUser,
    initialSavedRoomIds,
}: Props) {
    const router = useRouter();
    const [creating, setCreating] = useState(false);
    const [showCursor, setShowCursor] = useState(true);
    const [createError, setCreateError] = useState("");
    const [view, setView] = useState<View>(
        initialView === "me" ? "mine" : "recommended",
    );
    const [keyword, setKeyword] = useState("");
    const [savedRoomIds, setSavedRoomIds] = useState(initialSavedRoomIds);
    const navigationItems: {
        value: View;
        label: string;
        iconName: string;
    }[] = currentUser
        ? [
              {
                  value: "recommended",
                  label: "おすすめ",
                  iconName: "wandSparkles",
              },
              { value: "mine", label: "自分のルーム", iconName: "layoutGrid" },
              { value: "saved", label: "保存済み", iconName: "bookmark" },
          ]
        : [
              {
                  value: "recommended",
                  label: "おすすめ",
                  iconName: "wandSparkles",
              },
          ];

    const rooms = useMemo(() => {
        const roomsById = new Map<string, Room>();

        for (const room of publicRooms) {
            roomsById.set(room.id, room);
        }

        for (const room of myRooms) {
            roomsById.set(room.id, {
                ...room,
                userId: room.userId ?? currentUser?.id,
            });
        }

        // Keep the server-provided recommendation order for public rooms.
        return Array.from(roomsById.values());
    }, [publicRooms, myRooms, currentUser?.id]);

    const myRoomIds = useMemo(
        () => new Set(myRooms.map((room) => room.id)),
        [myRooms],
    );

    const roomsInView = useMemo(() => {
        if (view === "mine") {
            return [...myRooms].sort(
                (a, b) =>
                    new Date(b.updatedAt ?? 0).getTime() -
                    new Date(a.updatedAt ?? 0).getTime(),
            );
        }
        if (view === "saved") {
            return rooms.filter((room) => savedRoomIds.includes(room.id));
        }
        return rooms.filter((room) => room.visibility === "public");
    }, [view, myRooms, rooms, savedRoomIds]);

    const filteredRooms = useMemo(() => {
        const query = keyword.trim().toLowerCase();

        return roomsInView.filter((room) => {
                if (!query) return true;

                const searchableText = [room.id, room.title, room.explanation]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();

                return searchableText.includes(query);
            });
    }, [roomsInView, keyword]);

    const selectView = (nextView: View) => {
        if ((nextView === "mine" || nextView === "saved") && !currentUser) {
            return;
        }

        if (nextView === view) return;

        setView(nextView);

        const url = new URL(window.location.href);
        if (nextView === "recommended") {
            url.searchParams.delete("filter");
        } else {
            url.searchParams.set("filter", nextView);
        }

        window.history.pushState(
            window.history.state,
            "",
            url.pathname + (url.search ? url.search : ""),
        );
    };

    useEffect(() => {
        const handlePopState = () => {
            const nextView = getViewFromSearchParams(
                new URLSearchParams(window.location.search),
            );

            if ((nextView === "mine" || nextView === "saved") && !currentUser) {
                setView("recommended");
                return;
            }

            setView(nextView);
        };

        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [currentUser]);

    const toggleSavedRoomState = async (roomId: string) => {
        if (!currentUser) return;

        const wasSaved = savedRoomIds.includes(roomId);
        const nextSavedIds = wasSaved
            ? savedRoomIds.filter((id) => id !== roomId)
            : Array.from(new Set([...savedRoomIds, roomId]));

        setSavedRoomIds(nextSavedIds);

        const result = await toggleSavedRoom(roomId);
        if (result.error) {
            setSavedRoomIds((current) => {
                if (wasSaved) {
                    return current.includes(roomId)
                        ? current
                        : [...current, roomId];
                }
                return current.filter((id) => id !== roomId);
            });
            console.error(result.error);
            return;
        }

        posthog.capture("room_saved_toggled", {
            room_id: roomId,
            saved: result.saved,
        });
    };

    useEffect(() => {
        if (!currentUser) return;
        posthog.identify(currentUser.id, {
            email: currentUser.email,
            display_name: currentUser.displayName,
        });
    }, [currentUser]);

    const addRoom = async () => {
        if (creating) return;
        if (!currentUser) {
            startNavigationProgress();
            router.push(getSignInUrl());
            return;
        }

        setCreating(true);
        setCreateError("");
        try {
            const roomId = await createNewRoom();
            if (!roomId) throw new Error("Room creation returned no ID");
            posthog.capture("room_created");
            startNavigationProgress();
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
        startNavigationProgress();
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
        navigationItems.find((item) => item.value === view)?.label ??
        "おすすめ";

    return (
        <>
            <header className="w-full flex justify-end p-4 gap-4">
                {" "}
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
                                onClick: () => {
                                    startNavigationProgress();
                                    router.push(
                                        process.env
                                            .NEXT_PUBLIC_USER_SETTINGS_URL!,
                                    );
                                },
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
                        onClick={() => {
                            startNavigationProgress();
                            router.push(getSignInUrl());
                        }}
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

            <div className="flex flex-col w-full items-center gap-4">
                <div
                    aria-label="ルームカテゴリ"
                    className="w-full flex shrink-0 no-scrollbar overflow-x-scroll gap-4 px-[calc(max(50dvw-336px,0px)+16px)]"
                >
                    {navigationItems.map((item) => (
                        <Button
                            key={item.value}
                            className="w-fit shrink-0"
                            variant={
                                view === item.value ? "primary" : "default"
                            }
                            onClick={() => selectView(item.value)}
                            iconName={item.iconName}
                            alignment="left"
                        >
                            {item.label}
                        </Button>
                    ))}
                </div>

                <Shell size="large">
                    <div className="flex w-full flex-wrap items-center justify-between gap-4">
                        <h1 className="text-2xl font-bold" data-cursor="text">
                            {viewTitle}
                        </h1>
                        <Button
                            onClick={addRoom}
                            loading={creating}
                            iconName="plus"
                            className="w-fit shrink-0"
                        >
                            新規作成
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 w-full gap-4">
                            {filteredRooms.map((room) => (
                                <RoomCard
                                    key={room.id}
                                    room={room}
                                    isOwner={myRoomIds.has(room.id)}
                                    isSaved={savedRoomIds.includes(room.id)}
                                    onToggleSaved={
                                        currentUser
                                            ? () =>
                                                  toggleSavedRoomState(room.id)
                                            : undefined
                                    }
                                />
                            ))}
                        </div>
                    ) : (
                        <div>ルームが見つかりません。</div>
                    )}
                </Shell>
            </div>
        </>
    );
}
