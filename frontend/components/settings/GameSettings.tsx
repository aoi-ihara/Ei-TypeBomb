"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import MorphDialog from "@/components/ui/MorphDialog";
import Toggle from "@/components/ui/Toggle";

type Props = {
    backgroundMusic: boolean;
    soundEffects: boolean;
    onBackgroundMusicChange: (value: boolean) => void;
    onSoundEffectsChange: (value: boolean) => void;
    getLearningDiagnostic?: () => string | null;
    placement?: "inline" | "top-left";
};

export default function GameSettings({
    backgroundMusic,
    soundEffects,
    onBackgroundMusicChange,
    onSoundEffectsChange,
    placement = "inline",
    getLearningDiagnostic,
}: Readonly<Props>) {
    const [diagnosticStatus, setDiagnosticStatus] = useState<boolean | null>(
        null,
    );
    const [showSettings, setShowSettings] = useState(false);

    return (
        <div
            className={
                placement === "top-left"
                    ? "fixed left-4 top-4 z-20 w-18"
                    : "w-20 shrink-0"
            }
        >
            <MorphDialog
                button={
                    <Button
                        onClick={() => setShowSettings(!showSettings)}
                        padding="small"
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
                {process.env.NEXT_PUBLIC_BETA_ENVIRONMENT === "true" &&
                    getLearningDiagnostic && (
                        <>
                            <Button
                                className="w-full"
                                onClick={async () => {
                                    try {
                                        const json = getLearningDiagnostic();

                                        if (!json) {
                                            setDiagnosticStatus(false);
                                            return;
                                        }

                                        await navigator.clipboard.writeText(
                                            json,
                                        );
                                        setDiagnosticStatus(true);
                                    } catch {
                                        setDiagnosticStatus(false);
                                    } finally {
                                        setTimeout(() => {
                                            setDiagnosticStatus(null);
                                        }, 3000);
                                    }
                                }}
                                iconName={
                                    diagnosticStatus
                                        ? "check"
                                        : diagnosticStatus === false
                                          ? "x"
                                          : "clipboardPen"
                                }
                            >
                                出題診断をコピー
                            </Button>
                            <span role="status" aria-live="polite" className="text-sm px-3">
                                {diagnosticStatus === true
                                    ? "出題診断をコピーしました。"
                                    : diagnosticStatus === false
                                      ? "コピーできませんでした。ブラウザのクリップボード権限を確認してください。"
                                      : ""}
                            </span>
                        </>
                    )}
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
