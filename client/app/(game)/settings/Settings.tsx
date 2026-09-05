"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import posthog from "posthog-js";

type Props = {
    initialSounDeffects: boolean;
    initialBackgroundMusic: boolean;
    initialServerUrl: string;
};

export default function Settings({
    initialSounDeffects,
    initialBackgroundMusic,
}: Props) {
    const router = useRouter();

    const [backgroundMusic, setBackgroundMusic] = useState(
        initialBackgroundMusic,
    );
    const [sounDeffects, setSounDeffects] = useState(initialSounDeffects);

    const setCookie = (key: string, value: string) => {
        document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000`;
    };

    return (
        <Shell title="Settings" className="items-start flex flex-col">
            <div className="mb-4 w-full items-center flex justify-between">
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
            <div className="mb-4 w-full items-center flex justify-between">
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

            <Button
                onClick={() => router.push("/")}
                className="w-full"
                variant="primary"
                iconName="check"
            >
                Done
            </Button>
        </Shell>
    );
}
