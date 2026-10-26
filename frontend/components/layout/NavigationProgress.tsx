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
    const [progress, setProgress] = useState(0);
    const active = useSyncExternalStore(
        subscribeNavigationProgress,
        isNavigationProgressActive,
        () => false,
    );

    useEffect(() => {
        if (active) {
            setVisible(true);
            setProgress((current) =>
                current === 0 ? 6 : Math.min(current, 90),
            );

            // Navigation does not expose an exact percentage. Advance
            // gradually and reserve 100% for the completed navigation.
            const interval = window.setInterval(() => {
                setProgress((current) => {
                    if (current >= 90) return 90;
                    if (current < 20) return current + 8;
                    if (current < 50) return current + 5;
                    if (current < 75) return current + 2;
                    return Math.min(current + 1, 90);
                });
            }, 180);

            return () => {
                window.clearInterval(interval);
            };
        }

        if (!visible) return;

        setProgress(100);
        const timeout = window.setTimeout(() => {
            setVisible(false);
            setProgress(0);
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
            aria-label="ページ読み込みの進捗"
            aria-valuemin={visible ? 0 : undefined}
            aria-valuemax={visible ? 100 : undefined}
            aria-valuenow={visible ? Math.round(progress) : undefined}
            aria-hidden={!visible}
        >
            <div
                className="h-full bg-cyan-600 transition-[width] duration-200 ease-out motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
            />
        </div>
    );
}
