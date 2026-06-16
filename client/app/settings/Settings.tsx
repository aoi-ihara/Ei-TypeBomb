"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RetchedInput } from "@/components/ui/RetchedInput";

type Props = {
    initialSounDeffects: boolean;
    initialBackgroundMusic: boolean;
    initialServerUrl: string;
};

export default function Settings({
    initialSounDeffects,
    initialBackgroundMusic,
    initialServerUrl,
}: Props) {
    const router = useRouter();

    const [backgroundMusic, setBackgroundMusic] = useState(
        initialBackgroundMusic,
    );
    const [sounDeffects, setSounDeffects] = useState(initialSounDeffects);

    const [serverUrl, setServerUrl] = useState(initialServerUrl);

    const setCookie = (key: string, value: string) => {
        document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000`;
    };

    return (
        <div className="flex flex-col h-full items-start pt-16 px-4 max-w-md w-full">
            <h1
                data-cursor="text"
                className="font-mono w-full text-center mb-16 font-bold text-2xl"
            >
                Settings
            </h1>
            <div data-cursor="text" className="font-bold text-lg mb-4">
                Sound
            </div>
            <div className="mb-4 w-full items-center flex justify-between">
                <div data-cursor="text">Background Music</div>
                <div data-cursor="button" className="rounded-full flex">
                    <button
                        className={`w-16 ${backgroundMusic ? "bg-cyan-600" : "bg-(--color-background-secondary)"} h-8 rounded-full p-1 transition-all duration-200 ease-out active:scale-95`}
                        onClick={() => {
                            const next = !backgroundMusic;

                            setBackgroundMusic(next);

                            setCookie("background-music", String(next));
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
                        }}
                    >
                        <div
                            className={`h-6 w-8 rounded-full bg-(--color-foreground) ${sounDeffects && "ml-6"} transition-all duration-200 ease-out`}
                        ></div>
                    </button>
                </div>
            </div>
            <div data-cursor="text" className="font-bold text-lg mb-4">
                Connection
            </div>
            <div className="inline w-full relative mb-4" data-cursor="text">
                <RetchedInput
                    value={serverUrl}
                    onChange={(e) => {
                        const value = e.target.value;

                        setServerUrl(value);

                        setCookie("server-url", value);
                    }}
                    type="url"
                    className="font-mono pr-32"
                    placeholder="Server URL"
                >
                    <button
                        className="top-3 right-3 px-2 py-1 bg-(--color-background) rounded-md absolute"
                        data-cursor="button"
                        data-cursor-shape="1"
                        onClick={() => {
                            setServerUrl("");

                            setCookie("server-url", "");
                        }}
                    >
                        <div className="transition-all duration-200 ease-out active:scale-95 font-bold text-cyan-600">
                            Use Default
                        </div>
                    </button>
                </RetchedInput>
            </div>

            <div className="w-full flex justify-end">
                <div
                    className="rounded-lg w-24 flex"
                    data-cursor="button"
                    data-cursor-shape="0"
                >
                    <button
                        className={`text-lg active:scale-95 items-center font-bold bg-cyan-600 w-full justify-center py-2 rounded-lg text-white flex transition-all duration-200 ease-out`}
                        onClick={() => {
                            router.push("/");
                        }}
                    >
                        <div className="mr-1">Done</div>
                    </button>
                </div>
            </div>
        </div>
    );
}
