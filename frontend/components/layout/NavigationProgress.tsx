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
    const isVisible = active || visible;
    const displayedProgress = active ? Math.max(progress, 6) : progress;

    useEffect(() => {
        if (!active) return;

        const revealFrame = window.requestAnimationFrame(() => {
            setVisible(true);
            setProgress((current) =>
                current === 0 ? 6 : Math.min(current, 90),
            );
        });

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
            window.cancelAnimationFrame(revealFrame);
            window.clearInterval(interval);
        };
    }, [active]);

    useEffect(() => {
        if (active || !visible) return;

        const completeFrame = window.requestAnimationFrame(() => {
            setProgress(100);
        });
        const timeout = window.setTimeout(() => {
            setVisible(false);
            setProgress(0);
        }, 220);

        return () => {
            window.cancelAnimationFrame(completeFrame);
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

        document.addEventListener("click", handleClick, true);
        window.addEventListener("popstate", handlePopState);

        return () => {
            document.removeEventListener("click", handleClick, true);
            window.removeEventListener("popstate", handlePopState);
        };
    }, []);

    return (
        <div
            className={`pointer-events-none fixed inset-x-0 top-0 z-100 h-1 w-full overflow-hidden transition-opacity duration-(--duration-etb) ease-etb ${
                isVisible ? "opacity-100" : "opacity-0"
            }`}
            role={isVisible ? "progressbar" : undefined}
            aria-label="ページ読み込みの進捗"
            aria-valuemin={isVisible ? 0 : undefined}
            aria-valuemax={isVisible ? 100 : undefined}
            aria-valuenow={
                isVisible ? Math.round(displayedProgress) : undefined
            }
            aria-hidden={!isVisible}
        >
            <div
                className="h-full bg-cyan-600 transition-[width] duration-(--duration-etb) ease-etb motion-reduce:transition-none"
                style={{ width: `${displayedProgress}%` }}
            />
        </div>
    );
}
