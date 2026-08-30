"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

export default function PostHogEventTracker() {
    useEffect(() => {
        let dragStart: { x: number; y: number } | null = null;
        let gameFinishedCaptured = false;

        const captureClickEvent = (event: MouseEvent) => {
            const target = event.target as Element | null;
            const button = target?.closest("button");
            if (!button) return;

            const pathname = window.location.pathname;
            const text = button.textContent?.trim();
            const icon = button.querySelector<SVGElement>("[data-icon]")?.getAttribute("data-icon");

            if (pathname === "/" && text === "Play") {
                posthog.capture("play_clicked");
                return;
            }

            if (pathname === "/room" && text === "Play Demo") {
                posthog.capture("demo_started");
                return;
            }

            if (icon === "qrCode" && pathname.startsWith("/my-rooms/")) {
                posthog.capture("room_qr_opened");
                return;
            }

            if (icon === "trash") {
                if (/^\/my-rooms\/[^/]+$/.test(pathname)) {
                    posthog.capture("word_deleted");
                } else if (/^\/my-rooms\/[^/]+\/delete$/.test(pathname)) {
                    posthog.capture("room_deleted");
                }
            }
        };

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null;
            if (target?.textContent?.trim() === "☰") {
                dragStart = { x: event.clientX, y: event.clientY };
            }
        };

        const handlePointerUp = (event: PointerEvent) => {
            if (!dragStart) return;

            const distance = Math.hypot(
                event.clientX - dragStart.x,
                event.clientY - dragStart.y,
            );
            dragStart = null;

            if (distance > 8 && /^\/my-rooms\/[^/]+$/.test(window.location.pathname)) {
                posthog.capture("words_reordered");
            }
        };

        const observer = new MutationObserver(() => {
            if (gameFinishedCaptured) return;
            if (document.querySelector('button [data-icon="rotateCw"]')) {
                gameFinishedCaptured = true;
                posthog.capture("game_finished");
            }
        });

        document.addEventListener("click", captureClickEvent);
        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("pointerup", handlePointerUp);
        observer.observe(document.body, { childList: true, subtree: true });

        return () => {
            document.removeEventListener("click", captureClickEvent);
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("pointerup", handlePointerUp);
            observer.disconnect();
        };
    }, []);

    return null;
}
