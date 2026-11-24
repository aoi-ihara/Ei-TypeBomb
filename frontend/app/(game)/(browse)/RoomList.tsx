"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import type { Room } from "@/type";
import RoomGrid from "@/components/rooms/RoomGrid";
import Button from "@/components/ui/Button";
import { createNewRoom } from "@/lib/room/create";
import { getSignInUrl } from "@/lib/auth/sign-in-url";
import posthog from "posthog-js";
import Shell from "@/components/layout/Shell";
import Input from "@/components/ui/Input";
import { View } from "@/type";
import { getEditableRoomIds, selectRoomsForView } from "@/lib/room/list-view";
import { useRoomListViewer } from "@/components/rooms/RoomListViewerProvider";
import { getRoomListNavigationItems } from "@/lib/room/list-navigation";

const EMPTY_SAVED_ROOM_IDS: string[] = [];

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
    initialSavedRoomIds: string[] | null;
    /** Public ISR pages hydrate account-only controls from a private endpoint. */
    deferViewer?: boolean;
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
    const { snapshot, ensureLoaded, reconcile, toggleSaved } = useRoomListViewer();

    useEffect(() => {
        if (deferViewer) {
            ensureLoaded();
        } else {
            reconcile({
                currentUser: initialCurrentUser,
                ownedRoomIds: initialMyRooms.map(({ id }) => id),
                savedRoomIds: initialSavedRoomIds,
            });
        }
    }, [deferViewer, ensureLoaded, reconcile, initialCurrentUser, initialMyRooms, initialSavedRoomIds]);

    const useServerViewer = !deferViewer && snapshot.status === "idle";
    const currentUser = useServerViewer ? initialCurrentUser : snapshot.currentUser;
    const myRooms = useMemo(() => {
        if (!currentUser) return [];
        if (!deferViewer && currentUser.id === initialCurrentUser?.id) return initialMyRooms;
        return snapshot.ownedRoomIds.map((id) => ({ id, userId: currentUser.id }));
    }, [currentUser, deferViewer, initialCurrentUser, initialMyRooms, snapshot.ownedRoomIds]);
    const savedRoomIds = useServerViewer ? (initialSavedRoomIds ?? EMPTY_SAVED_ROOM_IDS) : snapshot.savedRoomIds;
    const viewerLoading = deferViewer && snapshot.status === "idle";
    const viewerError = deferViewer && snapshot.status === "error";

    const navigationItems = getRoomListNavigationItems(!!currentUser);

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

        try {
            const result = await toggleSaved(currentUser.id, roomId);
            if (!result) return;
            if (result.error) {
                console.error(result.error);
                return;
            }
            posthog.capture("room_saved_toggled", {
                room_id: roomId,
                saved: result.saved,
            });
        } catch (error) {
            console.error("Failed to update saved room", error);
        }
    };

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

    const viewTitle =
        navigationItems.find((item) => item.value === view)?.label ??
        "おすすめ";

    return (
        <Shell
            showHeader={false}
            size="xlarge"
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
