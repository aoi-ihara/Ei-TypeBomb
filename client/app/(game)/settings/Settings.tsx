"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
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
                <div data-cursor="button" className="rounded-full flex">
                    <button
                        className={`w-16 ${backgroundMusic ? "bg-cyan-600" : "bg-(--color-background-secondary)"} h-8 rounded-full p-1 transition-all duration-200 ease-out active:scale-95`}
                        onClick={() => {
                            const next = !backgroundMusic;

                            setBackgroundMusic(next);

                            setCookie("background-music", String(next));

                            posthog.capture("settings_changed", {
                                setting: "background_music",
                                value: next,
                            });
                        }}
                    >
                        <div
                            className={`h-6 w-8 rounded-full bg-(--color-foreground) ${backgroundMusic && "ml-6"} transition-all duration-200 ease-out`}
                        ></div>
                    </button>
                </div>
            </div>
            <div className="mb-4 w-full items-center flex justify-between">
                <div data-cursor="text">Sound Effects</div>
                <div data-cursor="button" className="rounded-full flex">
                    <button
                        className={`w-16 ${sounDeffects ? "bg-cyan-600" : "bg-(--color-background-secondary)"} h-8 rounded-full p-1 transition-all duration-200 ease-out active:scale-95`}
                        onClick={() => {
                            const next = !sounDeffects;

                            setSounDeffects(next);

                            setCookie("sound-effects", String(next));

                            posthog.capture("settings_changed", {
                                setting: "sound_effects",
                                value: next,
                            });
                        }}
                    >
                        <div
                            className={`h-6 w-8 rounded-full bg-(--color-foreground) ${sounDeffects && "ml-6"} transition-all duration-200 ease-out`}
                        ></div>
                    </button>
                </div>
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
