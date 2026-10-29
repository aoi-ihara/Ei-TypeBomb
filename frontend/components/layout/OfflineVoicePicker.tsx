"use client";

import { useState } from "react";
import Picker from "@/components/ui/Picker";
import type { OfflineVoiceReading } from "@/lib/settings";
import posthog from "posthog-js";

type Props = {
    initialValue?: OfflineVoiceReading;
};

const voiceReadings: OfflineVoiceReading[] = ["none", "question", "answer"];
const voiceReadingLabels = ["なし", "問題", "回答"];

const getStoredValue = (): OfflineVoiceReading => {
    const value = document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith("offline-voice-reading="))
        ?.split("=")[1];

    if (value === "question" || value === "answer") return value;
    return "none";
};

export default function OfflineVoicePicker({ initialValue }: Readonly<Props>) {
    const [value, setValue] = useState<OfflineVoiceReading>(
        () => initialValue ?? getStoredValue(),
    );

    const handleSelected = (index: number) => {
        const nextValue = voiceReadings[index] ?? "none";
        setValue(nextValue);
        document.cookie =
            "offline-voice-reading=" +
            nextValue +
            "; path=/; max-age=31536000; SameSite=Lax";
        posthog.capture("settings_changed", {
            setting: "offline_voice_reading",
            value: nextValue,
        });
    };

    return (
        <div className="flex w-full flex-col gap-2">
            <Picker
                name="読み上げ（オフライン）"
                labelPrefix="読み上げ（オフライン）"
                items={voiceReadingLabels}
                selection={voiceReadings.indexOf(value)}
                onSelected={handleSelected}
                itemIcons={[null, null, null]}
            />
        </div>
    );
}
