"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/layout/Shell";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

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
        <Shell title="Settings" className="items-start flex flex-col">
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
                <Input
                    value={serverUrl}
                    onChange={(e) => {
                        const value = e.target.value;

                        setServerUrl(value);

                        setCookie("server-url", value);
                    }}
                    type="url"
                    font="mono"
                    className="relative w-full"
                    inputClassName="pr-33"
                    label="Server URL"
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
                </Input>
            </div>

            <Button
                onClick={() => router.push("/")}
                className="w-full mt-4"
                variant="primary"
            >
                Done
            </Button>
        </Shell>
    );
}
