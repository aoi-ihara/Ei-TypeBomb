"use client";

import { useState } from "react";
import Toggle from "@/components/ui/Toggle";
import posthog from "posthog-js";

type Props = {
    initialSounDeffects: boolean;
    initialBackgroundMusic: boolean;
};

export default function Settings({
    initialSounDeffects,
    initialBackgroundMusic,
}: Props) {
    const [backgroundMusic, setBackgroundMusic] = useState(
        initialBackgroundMusic,
    );
    const [sounDeffects, setSounDeffects] = useState(initialSounDeffects);

    const setCookie = (key: string, value: string) => {
        document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000`;
    };

    return (
        <>
            <div className="w-full px-3 items-center flex justify-between">
                <div data-cursor="text">Background Music</div>
                <Toggle
                    checked={backgroundMusic}
                    onChange={(next) => {
                        setBackgroundMusic(next);
                        setCookie("background-music", String(next));
                        posthog.capture("settings_changed", {
                            setting: "background_music",
                            value: next,
                        });
                    }}
                />
            </div>
            <div className="w-full px-3 items-center flex justify-between">
                <div data-cursor="text">Sound Effects</div>
                <Toggle
                    checked={sounDeffects}
                    onChange={(next) => {
                        setSounDeffects(next);
                        setCookie("sound-effects", String(next));
                        posthog.capture("settings_changed", {
                            setting: "sound_effects",
                            value: next,
                        });
                    }}
                />
            </div>
        </>
    );
}
