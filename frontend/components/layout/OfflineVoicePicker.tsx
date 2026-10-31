"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import posthog from "posthog-js";
import Picker from "@/components/ui/Picker";
import type { OfflineVoiceReading } from "@/lib/settings";

type Props = {
    initialValue: OfflineVoiceReading;
};

const VOICE_READING_OPTIONS: ReadonlyArray<{
    value: OfflineVoiceReading;
    label: string;
}> = [
    { value: "none", label: "なし" },
    { value: "question", label: "問題" },
    { value: "answer", label: "回答" },
];

export default function OfflineVoicePicker({ initialValue }: Readonly<Props>) {
    const router = useRouter();
    const [value, setValue] = useState(initialValue);

    const handleSelected = (index: number) => {
        const nextValue = VOICE_READING_OPTIONS[index]?.value ?? "none";
        setValue(nextValue);
        document.cookie = `offline-voice-reading=${nextValue}; path=/; max-age=31536000; SameSite=Lax`;
        posthog.capture("settings_changed", {
            setting: "offline_voice_reading",
            value: nextValue,
        });

        // Refresh the server component so the offline game's speech setting
        // receives the newly saved cookie without restarting the game.
        router.refresh();
    };

    return (
        <div className="flex w-full flex-col gap-2">
            <Picker
                name="読み上げ（オフライン）"
                labelPrefix="読み上げ（オフライン）"
                padding="small"
                items={VOICE_READING_OPTIONS.map(({ label }) => label)}
                selection={VOICE_READING_OPTIONS.findIndex(
                    ({ value: optionValue }) => optionValue === value,
                )}
                onSelected={handleSelected}
                itemIcons={VOICE_READING_OPTIONS.map(() => null)}
            />
        </div>
    );
}
