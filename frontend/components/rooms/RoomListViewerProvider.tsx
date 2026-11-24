"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { toggleSavedRoom } from "@/lib/room/save";

/**
 * Only viewer-specific data lives here; public room summaries remain in the
 * Vercel ISR page. The browse layout keeps this provider mounted across
 * feeds and room details so the navigation retains its viewer state.
 */
export type FeedCurrentUser = {
    id: string;
    email: string | null;
    displayName: string | null;
};

export type FeedViewerSnapshot = {
    status: "idle" | "ready" | "error";
    currentUser: FeedCurrentUser | null;
    ownedRoomIds: string[];
    savedRoomIds: string[];
};

const GUEST: FeedViewerSnapshot = {
    status: "ready",
    currentUser: null,
    ownedRoomIds: [],
    savedRoomIds: [],
};

const INITIAL: FeedViewerSnapshot = { ...GUEST, status: "idle" };

type FeedViewerContext = {
    signedInHint: boolean;
    setSignedInHint: (signedIn: boolean) => void;
    reconcile: (viewer: Omit<FeedViewerSnapshot, "status" | "savedRoomIds"> & {
        savedRoomIds: string[] | null;
    }) => void;
    snapshot: FeedViewerSnapshot;
    ensureLoaded: () => void;
    retry: () => void;
    resetToGuest: () => FeedViewerSnapshot;
    finishSignOut: () => void;
    restore: (snapshot: FeedViewerSnapshot) => void;
    toggleSaved: (userId: string, roomId: string) => Promise<Awaited<ReturnType<typeof toggleSavedRoom>> | null>;
};

const Context = createContext<FeedViewerContext | null>(null);

const isViewerPayload = (value: unknown): value is Omit<FeedViewerSnapshot, "status"> => {
    if (!value || typeof value !== "object") return false;
    const data = value as Partial<FeedViewerSnapshot>;
    if (
        !Array.isArray(data.ownedRoomIds) ||
        !Array.isArray(data.savedRoomIds) ||
        !data.ownedRoomIds.every((id) => typeof id === "string") ||
        !data.savedRoomIds.every((id) => typeof id === "string")
    ) {
        return false;
    }
    if (data.currentUser === null) {
        return data.ownedRoomIds.length === 0 && data.savedRoomIds.length === 0;
    }
    return (
        !!data.currentUser &&
        typeof data.currentUser.id === "string" &&
        data.currentUser.id.length > 0
    );
};

export function RoomListViewerProvider({ children }: { children: ReactNode }) {
    const [snapshot, setSnapshot] = useState<FeedViewerSnapshot>(INITIAL);
    const [signedInHint, setSignedInHint] = useState(false);
    const snapshotRef = useRef<FeedViewerSnapshot>(INITIAL);
    const requestRef = useRef<AbortController | null>(null);
    const generationRef = useRef(0);
    const signOutRef = useRef<"pending" | "complete" | null>(null);
    const pendingSaves = useRef(new Map<string, { saved: boolean }>());

    const commit = useCallback((next: FeedViewerSnapshot) => {
        if (snapshotRef.current.currentUser?.id !== next.currentUser?.id)
            pendingSaves.current.clear();
        snapshotRef.current = next;

        if (pendingSaves.current.size === 0) {
            setSnapshot(next);
            return;
        }

        const savedRoomIds = new Set(next.savedRoomIds);
        for (const [roomId, { saved }] of pendingSaves.current) {
            if (saved) savedRoomIds.add(roomId);
            else savedRoomIds.delete(roomId);
        }
        setSnapshot({ ...next, savedRoomIds: [...savedRoomIds] });
    }, []);

    const cancelViewerRequest = useCallback(() => {
        ++generationRef.current;
        requestRef.current?.abort();
        requestRef.current = null;
    }, []);

    const fetchViewer = useCallback((verifyAfterSignOut = false) => {
        if (requestRef.current || (!verifyAfterSignOut && snapshotRef.current.status !== "idle")) return;

        const controller = new AbortController();
        const generation = ++generationRef.current;
        requestRef.current = controller;

        // Leave status as "idle" until the response arrives. Public-page
        // rendering is not delayed, and this avoids setState in mount effects.
        void (async () => {
            try {
                const response = await fetch("/api/room-list-viewer", {
                    credentials: "same-origin",
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error("Viewer lookup failed");
                const payload: unknown = await response.json();
                if (!isViewerPayload(payload)) throw new Error("Invalid viewer payload");
                if (controller.signal.aborted || generation !== generationRef.current) return;

                commit({
                    status: "ready",
                    currentUser: payload.currentUser,
                    ownedRoomIds: payload.ownedRoomIds,
                    savedRoomIds: payload.savedRoomIds,
                });
            } catch (error) {
                if (controller.signal.aborted || generation !== generationRef.current) return;
                console.error("Failed to load room viewer state", error);
                // Keep the signed-out UI if a recheck fails.
                if (!verifyAfterSignOut) commit({ ...GUEST, status: "error" });
            } finally {
                if (requestRef.current === controller) requestRef.current = null;
            }
        })();
    }, [commit]);

    const resetToGuest = useCallback(() => {
        const previous = snapshotRef.current;
        signOutRef.current = "pending";
        cancelViewerRequest();
        commit(GUEST);
        return previous;
    }, [cancelViewerRequest, commit]);

    const finishSignOut = useCallback(() => {
        if (signOutRef.current === "pending") signOutRef.current = "complete";
    }, []);

    const restore = useCallback((previous: FeedViewerSnapshot) => {
        signOutRef.current = null;
        cancelViewerRequest();
        commit(previous);
    }, [cancelViewerRequest, commit]);

    const reconcile = useCallback((viewer: Parameters<FeedViewerContext["reconcile"]>[0]) => {
        if (signOutRef.current === "pending") return;
        const previous = snapshotRef.current;
        const sameUser = viewer.currentUser?.id === previous.currentUser?.id;
        if (signOutRef.current === "complete" && viewer.currentUser && !sameUser) {
            // Cached personalized pages can carry an older identity after
            // sign-out. Only a fresh private lookup can restore that identity.
            fetchViewer(true);
            return;
        }
        cancelViewerRequest();
        commit({
            ...viewer,
            status: "ready",
            savedRoomIds: viewer.savedRoomIds ?? (sameUser ? previous.savedRoomIds : []),
        });
    }, [cancelViewerRequest, commit, fetchViewer]);

    const retry = useCallback(() => {
        cancelViewerRequest();
        commit(INITIAL);
        fetchViewer();
    }, [cancelViewerRequest, commit, fetchViewer]);

    const toggleSaved = useCallback(async (userId: string, roomId: string) => {
        const viewer = snapshotRef.current;
        if (viewer.currentUser?.id !== userId || pendingSaves.current.has(roomId)) return null;

        const pending = { saved: !viewer.savedRoomIds.includes(roomId) };
        pendingSaves.current.set(roomId, pending);
        commit(viewer);

        let result: Awaited<ReturnType<typeof toggleSavedRoom>> | undefined;
        try {
            result = await toggleSavedRoom(roomId);
            return pendingSaves.current.get(roomId) === pending ? result : null;
        } finally {
            // Reconciliation can replace the account while the action runs.
            if (pendingSaves.current.get(roomId) === pending) {
                pendingSaves.current.delete(roomId);
                const current = snapshotRef.current;
                if (result && !result.error) {
                    const savedRoomIds = new Set(current.savedRoomIds);
                    if (result.saved) savedRoomIds.add(roomId);
                    else savedRoomIds.delete(roomId);
                    commit({ ...current, savedRoomIds: [...savedRoomIds] });
                } else {
                    commit(current);
                }
            }
        }
    }, [commit]);

    const contextValue = useMemo(
        () => ({
            snapshot,
            signedInHint,
            setSignedInHint,
            reconcile,
            ensureLoaded: fetchViewer,
            retry,
            resetToGuest,
            finishSignOut,
            restore,
            toggleSaved,
        }),
        [snapshot, signedInHint, reconcile, fetchViewer, retry, resetToGuest, finishSignOut, restore, toggleSaved],
    );

    return <Context.Provider value={contextValue}>{children}</Context.Provider>;
}

export function useRoomListViewer(): FeedViewerContext {
    const context = useContext(Context);
    if (!context) throw new Error("RoomList must be inside RoomListViewerProvider");
    return context;
}
