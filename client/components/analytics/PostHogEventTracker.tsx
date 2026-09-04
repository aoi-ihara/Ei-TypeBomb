"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

const GENERATION_EXAMPLES = new Set([
    "高校1年生の定期テストの単語",
    "大学受験でよく見る英単語",
    "英語のニュースでよく使われる単語",
    "日常会話でよく使う英単語",
    "入国審査で言われそうな単語",
    "ホテルで使いそうな英単語",
]);

function isRoomEditorPath(pathname: string) {
    return /^\/my-rooms\/[^/]+$/.test(pathname);
}

function getRoomId(pathname: string) {
    return pathname.split("/").at(-1);
}

function isFeaturePanelElement(element: Element | null) {
    return !!element?.closest(".rounded-3xl");
}

export default function PostHogEventTracker() {
    useEffect(() => {
        let dragStart: { x: number; y: number } | null = null;
        let gameFinishedCaptured = false;
        let generationPanelOpen = false;
        let generationRequestPending = false;
        let importPanelOpen = false;
        let importRequestPending = false;

        const pathname = window.location.pathname;

        if (isRoomEditorPath(pathname)) {
            posthog.capture("room_editor_opened", {
                room_id: getRoomId(pathname),
            });
        }

        const captureClickEvent = (event: MouseEvent) => {
            const target = event.target as Element | null;
            const button = target?.closest("button");
            if (!button) return;

            const currentPathname = window.location.pathname;
            const text = button.textContent?.trim();
            const icon = button
                .querySelector<SVGElement>("[data-icon]")
                ?.getAttribute("data-icon");
            const inRoomEditor = isRoomEditorPath(currentPathname);
            const inFeaturePanel = isFeaturePanelElement(button);
            const roomId = getRoomId(currentPathname);

            if (currentPathname === "/" && text === "Play") {
                posthog.capture("play_clicked");
                return;
            }

            if (currentPathname === "/room" && text === "Play Demo") {
                posthog.capture("demo_started");
                return;
            }

            if (inRoomEditor && icon === "qrCode") {
                posthog.capture("room_qr_opened", { room_id: roomId });
                return;
            }

            if (
                inRoomEditor &&
                icon === "trash" &&
                text !== "Delete Room"
            ) {
                posthog.capture("word_deleted", { room_id: roomId });
                return;
            }

            if (inRoomEditor && icon === "download") {
                posthog.capture("words_exported", { room_id: roomId });
                return;
            }

            if (inRoomEditor && icon === "wandSparkles") {
                generationPanelOpen = !generationPanelOpen;
                generationRequestPending = false;
                importPanelOpen = false;
                importRequestPending = false;

                if (generationPanelOpen) {
                    posthog.capture("word_generation_opened", {
                        room_id: roomId,
                    });
                }
                return;
            }

            if (inRoomEditor && icon === "upload") {
                importPanelOpen = !importPanelOpen;
                importRequestPending = false;
                generationPanelOpen = false;
                generationRequestPending = false;

                if (importPanelOpen) {
                    posthog.capture("words_import_opened", {
                        room_id: roomId,
                    });
                }
                return;
            }

            if (
                inRoomEditor &&
                generationPanelOpen &&
                GENERATION_EXAMPLES.has(text ?? "") &&
                inFeaturePanel
            ) {
                posthog.capture("word_generation_example_selected", {
                    room_id: roomId,
                    example: text,
                });
                return;
            }

            if (
                inRoomEditor &&
                generationPanelOpen &&
                icon === "arrowRight" &&
                inFeaturePanel
            ) {
                generationRequestPending = true;
                posthog.capture("word_generation_requested", {
                    room_id: roomId,
                });
                return;
            }

            if (
                inRoomEditor &&
                generationPanelOpen &&
                text === "Add" &&
                inFeaturePanel
            ) {
                posthog.capture("generated_words_added", {
                    room_id: roomId,
                });
                generationPanelOpen = false;
                generationRequestPending = false;
                return;
            }

            if (
                inRoomEditor &&
                generationPanelOpen &&
                text === "Cancel" &&
                inFeaturePanel
            ) {
                posthog.capture("word_generation_cancelled", {
                    room_id: roomId,
                });
                generationPanelOpen = false;
                generationRequestPending = false;
                return;
            }

            if (
                inRoomEditor &&
                importPanelOpen &&
                text === "Learn More"
            ) {
                posthog.capture("words_import_help_opened", {
                    room_id: roomId,
                });
                return;
            }

            if (inRoomEditor && importPanelOpen && text === "Import") {
                importRequestPending = true;
                posthog.capture("words_import_submitted", {
                    room_id: roomId,
                });
                return;
            }

            if (
                inRoomEditor &&
                importPanelOpen &&
                text === "Cancel" &&
                inFeaturePanel
            ) {
                posthog.capture("words_import_cancelled", {
                    room_id: roomId,
                });
                importPanelOpen = false;
                importRequestPending = false;
                return;
            }

            if (inRoomEditor && text === "Visibility") {
                posthog.capture("room_visibility_settings_opened", {
                    room_id: roomId,
                });
                return;
            }

            if (
                inRoomEditor &&
                button.getAttribute("aria-label") === "Close dialog"
            ) {
                generationPanelOpen = false;
                generationRequestPending = false;
                importPanelOpen = false;
                importRequestPending = false;
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

            if (distance > 8 && isRoomEditorPath(window.location.pathname)) {
                posthog.capture("words_reordered", {
                    room_id: getRoomId(window.location.pathname),
                });
            }
        };

        const observer = new MutationObserver(() => {
            const gameFinishedButton = document.querySelector(
                'button [data-icon="rotateCw"]',
            );

            if (!gameFinishedButton) {
                gameFinishedCaptured = false;
            } else if (!gameFinishedCaptured) {
                gameFinishedCaptured = true;
                posthog.capture("game_finished");
            }

            if (generationRequestPending && generationPanelOpen) {
                const generatedWordsAddButton = Array.from(
                    document.querySelectorAll("button"),
                ).find(
                    (element) =>
                        element.textContent?.trim() === "Add" &&
                        isFeaturePanelElement(element),
                );

                if (generatedWordsAddButton) {
                    generationRequestPending = false;
                    posthog.capture("word_generation_succeeded", {
                        room_id: getRoomId(window.location.pathname),
                    });
                } else {
                    const generationError = Array.from(
                        document.querySelectorAll(".text-red-500"),
                    ).find((element) =>
                        element.textContent?.includes(
                            "Failed to generate words",
                        ),
                    );

                    if (generationError) {
                        generationRequestPending = false;
                        posthog.capture("word_generation_failed", {
                            room_id: getRoomId(window.location.pathname),
                        });
                    }
                }
            }

            if (importRequestPending && importPanelOpen) {
                const importButton = Array.from(
                    document.querySelectorAll("button"),
                ).find(
                    (element) =>
                        element.textContent?.trim() === "Import" &&
                        isFeaturePanelElement(element),
                );

                const importError = Array.from(
                    document.querySelectorAll(".text-red-500"),
                ).find((element) => {
                    const content = element.textContent ?? "";
                    return (
                        content.includes("JSON data is required") ||
                        content.includes("Invalid JSON format")
                    );
                });

                if (importError) {
                    importRequestPending = false;
                    posthog.capture("words_import_failed", {
                        room_id: getRoomId(window.location.pathname),
                    });
                } else if (!importButton) {
                    importRequestPending = false;
                    importPanelOpen = false;
                    posthog.capture("words_import_succeeded", {
                        room_id: getRoomId(window.location.pathname),
                    });
                }
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
