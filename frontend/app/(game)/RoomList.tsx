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
import { getEditableRoomIds, selectRoomsForView } from "@/lib/room/list-view";

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
    /** Public ISR pages hydrate account-only controls from a private endpoint. */
    deferViewer?: boolean;
};

type ViewerPayload = {
    currentUser: CurrentUser | null;
    ownedRoomIds: string[];
    savedRoomIds: string[];
};

export default function RoomList({
    publicRooms,
    myRooms: initialMyRooms,
    initialView,
    currentUser: initialCurrentUser,
    initialSavedRoomIds,
    deferViewer = false,
}: Props) {
    const router = useRouter();
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState("");
    const view = initialView;
    const [keyword, setKeyword] = useState("");
    // Keep typing responsive even when many rooms match the search.
    const deferredKeyword = useDeferredValue(keyword);
    const [currentUser, setCurrentUser] = useState(initialCurrentUser);
    const [myRooms, setMyRooms] = useState(initialMyRooms);
    const [savedRoomIds, setSavedRoomIds] = useState(initialSavedRoomIds);
    const [viewerLoading, setViewerLoading] = useState(deferViewer);
    const [viewerError, setViewerError] = useState(false);
    const [viewerRetry, setViewerRetry] = useState(0);

    // Account state is intentionally excluded from the ISR HTML. This request
    // is never cached and is the only user-specific request on public feeds.
    useEffect(() => {
        if (!deferViewer) return;
        const controller = new AbortController();
        const loadViewer = async () => {
            try {
                const response = await fetch("/api/room-list-viewer", {
                    credentials: "same-origin",
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error("Viewer lookup failed");
                const data = (await response.json()) as ViewerPayload;
                if (
                    !Array.isArray(data.ownedRoomIds) ||
                    !Array.isArray(data.savedRoomIds)
                ) {
                    throw new Error("Invalid viewer payload");
                }
                if (controller.signal.aborted) return;
                setCurrentUser(data.currentUser);
                setMyRooms(
                    data.currentUser
                        ? data.ownedRoomIds.map((id) => ({
                              id,
                              userId: data.currentUser!.id,
                          }))
                        : [],
                );
                setSavedRoomIds(data.currentUser ? data.savedRoomIds : []);
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("Failed to load room viewer state", error);
                setViewerError(true);
            } finally {
                if (!controller.signal.aborted) setViewerLoading(false);
            }
        };
        void loadViewer();
        return () => controller.abort();
    }, [deferViewer, viewerRetry]);
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

    const editableRoomIds = useMemo(
        () => getEditableRoomIds(myRooms, currentUser?.id ?? null),
        [myRooms, currentUser?.id],
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
        posthog.identify(currentUser.id);
    }, [currentUser]);

    const addRoom = async () => {
        if (creating || viewerLoading || viewerError) return;
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
            startNavigationProgress();
            router.push("/" + roomLink + "/edit");
        } catch (error) {
            posthog.capture("room_creation_failed");
            console.error("Failed to create room:", error);
            setCreateError(
                "ルームを作成できませんでした。もう一度お試しください。",
            );
            setCreating(false);
        }
    };

    const handleSignOut = async () => {
        // A redirect back to the same ISR route can preserve this component.
        // Remove per-viewer controls *before* the redirecting Server Action,
        // instead of relying on a remount or the effect's unchanged deps.
        const previousViewer = { currentUser, myRooms, savedRoomIds };
        setCurrentUser(null);
        setMyRooms([]);
        setSavedRoomIds([]);
        posthog.capture("signed_out");
        posthog.reset();

        try {
            await signOut();
            startNavigationProgress();
            router.replace("/");
        } catch (error) {
            // If signing out fails, restore the last authenticated view.
            setCurrentUser(previousViewer.currentUser);
            setMyRooms(previousViewer.myRooms);
            setSavedRoomIds(previousViewer.savedRoomIds);
            if (previousViewer.currentUser) {
                posthog.identify(previousViewer.currentUser.id);
            }
            console.error("Failed to sign out", error);
        }
    };

    const viewTitle =
        navigationItems.find((item) => item.value === view)?.label ??
        "おすすめ";

    return (
        <Shell
            sidebar={
                <RoomNavigation
                    isSignedIn={!!currentUser}
                    currentView={view}
                    viewerLoading={viewerLoading}
                />
            }
            header={
                viewerLoading ? (
                    <div className="h-10 w-28" aria-label="アカウント情報を読み込み中" />
                ) : viewerError ? (
                    <Button
                        variant="text"
                        onClick={() => {
                            setViewerLoading(true);
                            setViewerError(false);
                            setViewerRetry((count) => count + 1);
                        }}
                    >
                        再読み込み
                    </Button>
                ) : currentUser ? (
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
                    disabled={viewerLoading || viewerError}
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
                    editableRoomIds={editableRoomIds}
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
