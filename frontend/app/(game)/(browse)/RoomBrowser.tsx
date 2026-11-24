"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { unstable_rethrow, usePathname, useRouter, useSelectedLayoutSegment } from "next/navigation";
import posthog from "posthog-js";
import Header from "@/components/layout/Header";
import Sidebar from "@/components/layout/Sidebar";
import Navigation from "@/components/layout/Navigation";
import { useRoomListViewer } from "@/components/rooms/RoomListViewerProvider";
import Button from "@/components/ui/Button";
import Menu from "@/components/ui/Menu";
import { identifyPostHogUser } from "@/lib/analytics/posthog-identity";
import { getSignInUrl } from "@/lib/auth/sign-in-url";
import { signOut } from "@/lib/auth/sign-out";
import { startNavigationProgress } from "@/lib/navigation-progress";
import { getRoomListNavigationItems } from "@/lib/room/list-navigation";

const feedSegments = new Set([null, "latest", "mine", "saved", "viewer-feed-internal"]);
const getSidebarItems = (signedIn: boolean) =>
    getRoomListNavigationItems(signedIn).map(({ label, iconName, url }) => ({
        label,
        iconName,
        href: url,
    }));
const publicItems = getSidebarItems(false);
const signedInItems = getSidebarItems(true);
const RoomListBackContext = createContext("/");

export function useRoomListBackHref() {
    return useContext(RoomListBackContext);
}

function ViewerActions() {
    const router = useRouter();
    const viewer = useRoomListViewer();
    const { currentUser, status } = viewer.snapshot;

    useEffect(() => {
        if (currentUser) identifyPostHogUser(currentUser);
    }, [currentUser]);

    const handleSignOut = async () => {
        // The layout and bookmark UI can survive the action's redirect.
        const previousSnapshot = viewer.resetToGuest();
        posthog.capture("signed_out");
        posthog.reset();
        try {
            await signOut();
            startNavigationProgress();
            router.replace("/");
        } catch (error) {
            unstable_rethrow(error);
            viewer.restore(previousSnapshot);
            if (currentUser) identifyPostHogUser(currentUser);
            console.error("Failed to sign out", error);
        } finally {
            viewer.finishSignOut();
        }
    };

    const navigate = (href: string) => {
        startNavigationProgress();
        router.push(href);
    };

    if (status === "idle") {
        return (
            <div className="invisible pointer-events-none" aria-hidden="true">
                <Button variant="text">サインイン</Button>
            </div>
        );
    }
    if (status === "error") {
        return <Button variant="text" onClick={viewer.retry}>再読み込み</Button>;
    }
    if (!currentUser) {
        return <Button variant="text" onClick={() => navigate(getSignInUrl())}>サインイン</Button>;
    }
    return (
        <Menu
            name="ユーザーアクション"
            button={<Button variant="text" iconName="circleUserRound">ユーザー</Button>}
            items={[
                { label: "ユーザー設定", icon: "userRoundCog", onClick: () => navigate("/account") },
                { label: "サインアウト", icon: "logOut", onClick: handleSignOut },
            ]}
        />
    );
}

export default function RoomBrowser({ children }: { children: ReactNode }) {
    const segment = useSelectedLayoutSegment();
    const isFeed = feedSegments.has(segment);
    const pathname = usePathname();
    const [backHref, setBackHref] = useState("/");
    // Keep the last public-facing list URL across the shared browse layout.
    // Rewritten feeds use the browser pathname, never their internal route.
    const listPath = pathname?.replace(/\/+$/, "") || "/";
    if (isFeed && signedInItems.some(({ href }) => href === listPath) && backHref !== listPath) {
        setBackHref(listPath);
    }
    const { snapshot, signedInHint } = useRoomListViewer();
    const signedIn = snapshot.status === "idle" ? signedInHint : Boolean(snapshot.currentUser);

    return (
        <>
            <Header>{isFeed && <ViewerActions />}</Header>
            {/* A room gate hides the rail without replacing the shared layout. */}
            <div className="w-full [&:has([data-room-password-gate])_[data-sidebar-navigation]]:hidden">
                <Sidebar items={signedIn ? signedInItems : publicItems}>
                    <RoomListBackContext.Provider value={backHref}>
                        <Navigation>{children}</Navigation>
                    </RoomListBackContext.Provider>
                </Sidebar>
            </div>
        </>
    );
}
