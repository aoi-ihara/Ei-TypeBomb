"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type ReactNode,
    type SetStateAction,
} from "react";

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
    initialize: (viewer: Omit<FeedViewerSnapshot, "status">) => void;
    snapshot: FeedViewerSnapshot;
    ensureLoaded: () => void;
    retry: () => void;
    resetToGuest: () => void;
    restore: (snapshot: FeedViewerSnapshot) => void;
    setSavedRoomIds: Dispatch<SetStateAction<string[]>>;
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

    const commit = useCallback((next: FeedViewerSnapshot) => {
        snapshotRef.current = next;
        setSnapshot(next);
    }, []);

    const fetchViewer = useCallback(() => {
        if (requestRef.current || snapshotRef.current.status !== "idle") return;

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
                // Do not retain old owner controls after an auth/network error.
                commit({ ...GUEST, status: "error" });
            } finally {
                if (requestRef.current === controller) requestRef.current = null;
            }
        })();
    }, [commit]);

    const resetToGuest = useCallback(() => {
        ++generationRef.current;
        requestRef.current?.abort();
        requestRef.current = null;
        commit({ ...GUEST });
    }, [commit]);

    const restore = useCallback(
        (previous: FeedViewerSnapshot) => {
            ++generationRef.current;
            requestRef.current?.abort();
            requestRef.current = null;
            commit(previous);
        },
        [commit],
    );

    const initialize = useCallback((viewer: Omit<FeedViewerSnapshot, "status">) => {
        // Existing viewer state includes optimistic saves and same-layout sign-out.
        if (snapshotRef.current.status !== "ready")
            restore({ ...viewer, status: "ready" });
    }, [restore]);

    const retry = useCallback(() => {
        ++generationRef.current;
        requestRef.current?.abort();
        requestRef.current = null;
        // Called from a click handler; reset before starting the private fetch.
        commit({ ...INITIAL });
        // fetchViewer uses snapshotRef rather than captured React state.
        fetchViewer();
    }, [commit, fetchViewer]);

    const setSavedRoomIds = useCallback<Dispatch<SetStateAction<string[]>>>(
        (value) => {
            setSnapshot((previous) => {
                if (!previous.currentUser || previous.status !== "ready") return previous;
                const savedRoomIds =
                    typeof value === "function" ? value(previous.savedRoomIds) : value;
                const next = { ...previous, savedRoomIds };
                snapshotRef.current = next;
                return next;
            });
        },
        [],
    );

    const contextValue = useMemo(
        () => ({
            snapshot,
            signedInHint,
            setSignedInHint,
            initialize,
            ensureLoaded: fetchViewer,
            retry,
            resetToGuest,
            restore,
            setSavedRoomIds,
        }),
        [snapshot, signedInHint, initialize, fetchViewer, retry, resetToGuest, restore, setSavedRoomIds],
    );

    return <Context.Provider value={contextValue}>{children}</Context.Provider>;
}

export function useRoomListViewer(): FeedViewerContext {
    const context = useContext(Context);
    if (!context) throw new Error("RoomList must be inside RoomListViewerProvider");
    return context;
}
