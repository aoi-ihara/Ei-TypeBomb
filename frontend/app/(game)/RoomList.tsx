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
import Header from "@/components/layout/Header";
import { View } from "@/type";
import RoomNavigation from "./RoomNavigation";
import { selectRoomsForView } from "@/lib/room/list-view";

type CurrentUser = {
    id: string;
    email: string | null;
    displayName: string | null;
};

type Props = {
    publicRooms: Room[];
    myRooms: Room[];
    initialView: View;
    currentUser: CurrentUser | null;
    initialSavedRoomIds: string[];
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
    const [createError, setCreateError] = useState("");
    const view = initialView;
    const [keyword, setKeyword] = useState("");
    const [savedRoomIds, setSavedRoomIds] = useState(initialSavedRoomIds);
    const navigationItems: {
        value: View;
        label: string;
        url: string;
        iconName: string;
    }[] = currentUser
        ? [
              {
                  value: "recommended",
                  label: "おすすめ",
                  url: "/",
                  iconName: "wandSparkles",
              },
              {
                  value: "mine",
                  label: "自分のルーム",
                  url: "/mine",
                  iconName: "user",
              },
              {
                  value: "saved",
                  label: "保存済み",
                  url: "/saved",
                  iconName: "bookmark",
              },
          ]
        : [
              {
                  value: "recommended",
                  label: "おすすめ",
                  url: "/",
                  iconName: "wandSparkles",
              },
          ];

    const myRoomIds = useMemo(
        () => new Set(myRooms.map((room) => room.id)),
        [myRooms],
    );

    const roomsInView = useMemo(
        () =>
            selectRoomsForView({
                view,
                publicRooms,
                myRooms,
                savedRoomIds,
                currentUserId: currentUser?.id ?? null,
            }),
        [view, publicRooms, myRooms, savedRoomIds, currentUser?.id],
    );

    const filteredRooms = useMemo(() => {
        const query = keyword.trim().toLowerCase();

        return roomsInView.filter((room) => {
            if (!query) return true;

            const searchableText = [
                room.link,
                room.id,
                room.title,
                room.explanation,
            ]
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

        const paths: Record<View, string> = {
            recommended: "/",
            mine: "/mine",
            saved: "/saved",
        };

        startNavigationProgress();
        router.push(paths[nextView]);
    };

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
            const roomLink = await createNewRoom();
            if (!roomLink) throw new Error("Room creation returned no link");
            posthog.capture("room_created");
            startNavigationProgress();
            router.push("/" + roomLink + "/edit");
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

    const viewTitle =
        navigationItems.find((item) => item.value === view)?.label ??
        "おすすめ";

    return (
        <>
            <Header>
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
            </Header>

            <div className="flex w-full flex-col sm:flex-row gap-12 sm:gap-0">
                <RoomNavigation isSignedIn={!!currentUser} currentView={view} />
                <Shell size="large" title={viewTitle}>
                    <div className="flex w-full items-center justify-between gap-4">
                        <Input
                            value={keyword}
                            onChange={(event) => setKeyword(event.target.value)}
                            label="ルームを検索"
                            autoComplete="off"
                        />
                        <Button
                            onClick={addRoom}
                            loading={creating}
                            padding="large"
                            variant="primary"
                            iconName="plus"
                            className="w-fit shrink-0"
                        >
                            新規作成
                        </Button>
                    </div>

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
