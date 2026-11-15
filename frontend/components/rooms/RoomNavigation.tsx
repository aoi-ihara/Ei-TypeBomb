"use client";

import Button from "@/components/ui/Button";
import { View } from "@/type";
import { getRoomListNavigationItems } from "@/lib/room/list-navigation";

export default function RoomNavigation({
    isSignedIn,
    currentView,
    viewerLoading = false,
}: {
    isSignedIn: boolean;
    currentView?: View;
    viewerLoading?: boolean;
}) {
    const navigationItems = getRoomListNavigationItems(isSignedIn);

    return (
        <div className="w-full sm:w-48 sm:pr-0 shrink-0 px-4 flex sm:flex-col gap-4 overflow-x-scroll no-scrollbar">
            {navigationItems.map((item, index) => (
                <Button
                    href={item.url}
                    className="sm:w-full shrink-0 w-fit"
                    alignment="left"
                    iconName={item.iconName}
                    key={item.label}
                    variant={
                        currentView &&
                        Math.max(
                            0,
                            navigationItems.findIndex(
                                (item) => item.value === currentView,
                            ),
                        ) === index
                            ? "primary"
                            : "default"
                    }
                >
                    {item.label}
                </Button>
            ))}
            {viewerLoading && [0, 1].map((index) => (
                <div
                    key={`viewer-placeholder-${index}`}
                    aria-hidden="true"
                    className="hidden sm:block h-10 w-full shrink-0"
                />
            ))}
        </div>
    );
}
