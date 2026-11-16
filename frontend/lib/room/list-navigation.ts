import type { View } from "@/type";
import type { IconName } from "@/components/ui/Icon";

export type RoomListNavigationItem = {
    value: View;
    label: string;
    url: string;
    iconName: IconName;
};

// Public links must be first. Keep the same order, labels and icons as the
// previous separate RoomList/RoomNavigation declarations.
const ALL_ITEMS: readonly RoomListNavigationItem[] = [
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
];

const GUEST_ITEMS = ALL_ITEMS.slice(0, 2);

/** One source of truth for the sidebar and its page title. */
export const getRoomListNavigationItems = (isSignedIn: boolean) =>
    isSignedIn ? ALL_ITEMS : GUEST_ITEMS;
