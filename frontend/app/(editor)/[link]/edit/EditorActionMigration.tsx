"use client";

import { useEffect } from "react";

export default function EditorActionMigration() {
    useEffect(() => {
        const syncActions = () => {
            const qrButton = document.querySelector<HTMLButtonElement>(
                'button:has(svg[data-icon="qrCode"])',
            );
            const copyButton = document.querySelector<HTMLButtonElement>(
                'button:has(svg[data-icon="copy"])',
            );
            const playButton = document.querySelector<HTMLButtonElement>(
                'button:has(svg[data-icon="play"])',
            );

            if (!qrButton || !copyButton || !playButton) return;

            const qrContainer = qrButton.parentElement;
            const copyContainer = copyButton.parentElement;
            const actionsContainer = qrContainer?.parentElement;
            const playContainer = playButton.parentElement;

            if (
                !qrContainer ||
                !copyContainer ||
                !actionsContainer ||
                !playContainer
            ) {
                return;
            }

            qrContainer.style.display = "none";
            copyContainer.style.display = "none";
            playContainer.style.display = "none";

            let migratedPlayButton =
                actionsContainer.querySelector<HTMLButtonElement>(
                    "[data-migrated-play-button]",
                );

            if (!migratedPlayButton) {
                migratedPlayButton = playButton.cloneNode(
                    true,
                ) as HTMLButtonElement;
                migratedPlayButton.className = qrButton.className;
                migratedPlayButton.removeAttribute("data-cursor");
                migratedPlayButton.setAttribute(
                    "data-migrated-play-button",
                    "true",
                );
                migratedPlayButton.setAttribute("aria-label", "プレイ");
                migratedPlayButton.title = "プレイ";
                migratedPlayButton.addEventListener("click", () => {
                    playButton.click();
                });
                actionsContainer.appendChild(migratedPlayButton);
            }
        };

        syncActions();
        const observer = new MutationObserver(syncActions);
        observer.observe(document.body, { childList: true, subtree: true });

        return () => observer.disconnect();
    }, []);

    return null;
}
