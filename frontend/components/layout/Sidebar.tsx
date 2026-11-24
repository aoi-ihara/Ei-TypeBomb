"use client";

import { usePathname } from "next/navigation";
import { memo, useSyncExternalStore, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import type { IconName } from "@/components/ui/Icon";

export type SidebarItem = {
    label: string;
    iconName?: IconName;
    href: string;
};

type SidebarProps = {
    items: readonly SidebarItem[];
    children: ReactNode;
    actions?: ReactNode;
};

const subscribeToHydration = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
const normalizePath = (path: string) => path.replace(/\/+$/, "") || "/";

function Sidebar({ items, children, actions }: SidebarProps) {
    const pathname = usePathname();
    // Rewrites can give the server a different path from the browser.
    const hydrated = useSyncExternalStore(
        subscribeToHydration,
        getClientSnapshot,
        getServerSnapshot,
    );
    const currentPath = hydrated && pathname ? normalizePath(pathname) : null;
    let activeItem: SidebarItem | undefined;
    let activePath = "";
    for (const item of items) {
        const path = normalizePath(item.href);
        const matches =
            currentPath === path ||
            (path !== "/" && currentPath?.startsWith(path + "/"));
        if (matches && path.length > activePath.length) {
            activeItem = item;
            activePath = path;
        }
    }

    return (
        <div className="flex w-full flex-col gap-12 sm:flex-row sm:gap-0">
            <nav
                data-sidebar-navigation
                aria-label="ページナビゲーション"
                className="w-full sm:w-48 sm:pr-0 shrink-0 px-4 flex sm:flex-col gap-4 overflow-x-scroll no-scrollbar"
            >
                {items.map((item) => (
                    <Button
                        key={item.href}
                        href={item.href}
                        className="w-fit shrink-0 sm:w-full"
                        alignment="left"
                        padding="small"
                        iconName={item.iconName}
                        variant={item === activeItem ? "primary" : "default"}
                        aria-current={
                            item === activeItem
                                ? currentPath === activePath
                                    ? "page"
                                    : "location"
                                : undefined
                        }
                    >
                        {item.label}
                    </Button>
                ))}
                {actions}
            </nav>
            <div className="min-w-0 w-full">{children}</div>
        </div>
    );
}

export default memo(Sidebar);
