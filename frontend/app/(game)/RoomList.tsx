"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import type { Room } from "@/type";
import RoomGrid from "@/components/rooms/RoomGrid";
import Button from "@/components/ui/Button";
import { createNewRoom } from "@/lib/room/create";
import { getSignInUrl } from "@/lib/auth/sign-in-url";
import { signOut } from "@/lib/auth/sign-out";
import { toggleSavedRoom } from "@/lib/room/save";
import posthog from "posthog-js";
import Menu from "@/components/ui/Menu";
import Shell from "@/components/layout/Shell";
import Input from "@/components/ui/Input";
import { View } from "@/type";
import RoomNavigation from "@/components/rooms/RoomNavigation";
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
    // Keep typing responsive even when many rooms match the search.
    const deferredKeyword = useDeferredValue(keyword);
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
                  value: "latest",
                  label: "最新",
                  url: "/latest",
                  iconName: "clock",
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
              {
                  value: "latest",
                  label: "最新",
                  url: "/latest",
                  iconName: "clock",
              },
          ];

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
        const query = deferredKeyword.trim().toLowerCase();

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
    }, [roomsInView, deferredKeyword]);

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
        <Shell
            sidebar={
                <RoomNavigation isSignedIn={!!currentUser} currentView={view} />
            }
            header={
                currentUser ? (
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
                                    router.push("/account");
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
                        サインイン
                    </Button>
                )
            }
            size="large"
            title={viewTitle}
        >
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
                <RoomGrid
                    key={view + ":" + deferredKeyword}
                    rooms={filteredRooms}
                    savedIds={savedRoomIds}
                    onToggleSaved={
                        currentUser ? toggleSavedRoomState : undefined
                    }
                />
            ) : (
                <div>ルームが見つかりません。</div>
            )}
        </Shell>
    );
}
