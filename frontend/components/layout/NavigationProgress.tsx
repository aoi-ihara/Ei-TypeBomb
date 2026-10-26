"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
    isNavigationProgressActive,
    startNavigationProgress,
    stopNavigationProgress,
    subscribeNavigationProgress,
} from "@/lib/navigation-progress";

export default function NavigationProgress() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const locationKey = `${pathname}?${searchParams.toString()}`;
    const previousLocationKey = useRef(locationKey);
    const [visible, setVisible] = useState(false);
    const [complete, setComplete] = useState(false);
    const active = useSyncExternalStore(
        subscribeNavigationProgress,
        isNavigationProgressActive,
        () => false,
    );

    useEffect(() => {
        if (active) {
            setVisible(true);
            setComplete(false);
            return;
        }

        if (!visible) return;

        setComplete(true);
        const timeout = window.setTimeout(() => {
            setVisible(false);
        }, 220);

        return () => {
            window.clearTimeout(timeout);
        };
    }, [active, visible]);

    useEffect(() => {
        if (previousLocationKey.current === locationKey) return;

        previousLocationKey.current = locationKey;
        stopNavigationProgress("navigation");
    }, [locationKey]);

    useEffect(() => {
        const handleClick = (event: MouseEvent) => {
            if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
            ) {
                return;
            }

            const target = event.target;
            if (!(target instanceof Element)) return;

            const anchor = target.closest<HTMLAnchorElement>("a[href]");
            if (
                !anchor ||
                anchor.hasAttribute("download") ||
                (anchor.target && anchor.target !== "_self")
            ) {
                return;
            }

            let destination: URL;
            try {
                destination = new URL(anchor.href, window.location.href);
            } catch {
                return;
            }

            if (
                destination.origin !== window.location.origin ||
                (destination.pathname === window.location.pathname &&
                    destination.search === window.location.search)
            ) {
                return;
            }

            startNavigationProgress();
        };

        const handlePopState = () => {
            const currentLocationKey = `${window.location.pathname}?${new URLSearchParams(
                window.location.search,
            ).toString()}`;

            if (currentLocationKey !== previousLocationKey.current) {
                startNavigationProgress();
            }
        };

        document.addEventListener("click", handleClick);
        window.addEventListener("popstate", handlePopState);

        return () => {
            document.removeEventListener("click", handleClick);
            window.removeEventListener("popstate", handlePopState);
        };
    }, []);

    return (
        <div
            className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-4 w-full overflow-hidden bg-cyan-600/20 transition-opacity duration-200 ${
                visible ? "opacity-100" : "opacity-0"
            }`}
            role={visible ? "progressbar" : undefined}
            aria-label="ページを読み込み中"
            aria-hidden={!visible}
        >
            <div
                className={`h-full bg-cyan-600 transition-[width,transform] duration-200 ${
                    complete
                        ? "w-full translate-x-0"
                        : visible
                          ? "etb-progress-indeterminate w-1/3"
                          : "w-1/3 -translate-x-full"
                }`}
            />
        </div>
    );
}
