"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Button from "@/components/ui/Button";
import MorphDialog from "@/components/ui/MorphDialog";
import Toggle from "@/components/ui/Toggle";
import OfflineVoicePicker from "@/components/layout/OfflineVoicePicker";

type Props = {
    backgroundMusic: boolean;
    soundEffects: boolean;
    onBackgroundMusicChange: (value: boolean) => void;
    onSoundEffectsChange: (value: boolean) => void;
    placement?: "inline" | "top-left";
};

export default function GameSettings({
    backgroundMusic,
    soundEffects,
    onBackgroundMusicChange,
    onSoundEffectsChange,
    placement = "inline",
}: Readonly<Props>) {
    const pathname = usePathname();
    const [showSettings, setShowSettings] = useState(false);
    const isOfflineGame = pathname?.endsWith("/offline") ?? false;

    return (
        <div
            className={
                placement === "top-left"
                    ? "fixed left-4 top-4 z-20 w-18"
                    : "w-18 shrink-0"
            }
        >
            <MorphDialog
                button={
                    <Button
                        variant="text"
                        onClick={() => setShowSettings(!showSettings)}
                        iconName="settings"
                        className="w-full"
                    >
                        設定
                    </Button>
                }
                title="設定"
                alignment="vertical"
                open={showSettings}
                onClose={() => setShowSettings(false)}
            >
                <div className="flex w-full items-center justify-between pl-3">
                    <div data-cursor="text">BGM</div>
                    <Toggle
                        checked={backgroundMusic}
                        onChange={onBackgroundMusicChange}
                    />
                </div>
                <div className="flex w-full items-center justify-between pl-3">
                    <div data-cursor="text">効果音</div>
                    <Toggle
                        checked={soundEffects}
                        onChange={onSoundEffectsChange}
                    />
                </div>
                {isOfflineGame && <OfflineVoicePicker />}
                <Button
                    className="w-full"
                    variant="primary"
                    iconName="check"
                    onClick={() => setShowSettings(false)}
                >
                    完了
                </Button>
            </MorphDialog>
        </div>
    );
}
