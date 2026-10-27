"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import MorphDialog from "@/components/ui/MorphDialog";
import Picker from "@/components/ui/Picker";
import Toggle from "@/components/ui/Toggle";
import type { OfflineVoiceReading } from "@/lib/settings";

type Props = {
    backgroundMusic: boolean;
    soundEffects: boolean;
    offlineVoiceReading: OfflineVoiceReading;
    onBackgroundMusicChange: (value: boolean) => void;
    onSoundEffectsChange: (value: boolean) => void;
    onOfflineVoiceReadingChange: (value: OfflineVoiceReading) => void;
    placement?: "inline" | "top-left";
};

const voiceReadings: OfflineVoiceReading[] = ["none", "question", "answer"];
const voiceReadingLabels = ["なし", "問題", "回答"];

export default function GameSettings({
    backgroundMusic,
    soundEffects,
    offlineVoiceReading,
    onBackgroundMusicChange,
    onSoundEffectsChange,
    onOfflineVoiceReadingChange,
    placement = "inline",
}: Readonly<Props>) {
    const [showSettings, setShowSettings] = useState(false);

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
                <div className="flex w-full flex-col gap-2">
                    <div className="pl-3" data-cursor="text">
                        音声読み上げ（オフライン）
                    </div>
                    <Picker
                        name="音声読み上げ（オフライン）"
                        labelPrefix="音声読み上げ（オフライン）"
                        items={voiceReadingLabels}
                        selection={voiceReadings.indexOf(offlineVoiceReading)}
                        onSelected={(index) =>
                            onOfflineVoiceReadingChange(
                                voiceReadings[index] ?? "none",
                            )
                        }
                        itemIcons={[null, null, null]}
                    />
                </div>
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
