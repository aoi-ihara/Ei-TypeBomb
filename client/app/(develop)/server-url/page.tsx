"use client";

import { useState } from "react";
import Shell from "@/components/layout/Shell";
import Input from "@/components/ui/Input";

type Props = {
    initialServerUrl: string;
};

export default function ServerUrl({ initialServerUrl }: Props) {
    const [serverUrl, setServerUrl] = useState<string>(initialServerUrl ?? "");

    const setCookie = (key: string, value: string) => {
        document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000`;
    };

    return (
        <Shell title="Server URL">
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
                    <div
                        className="bg-(--color-background) absolute top-3 rounded-md right-3"
                        data-cursor="button"
                        data-cursor-shape="1"
                    >
                        <button
                            className="active:scale-95 cursor-pointer px-2 py-1 transition-all duration-200 ease-out"
                            onClick={() => {
                                setServerUrl("");
                                setCookie("server-url", "");
                            }}
                        >
                            <div className="transition-all duration-200 ease-out font-bold text-cyan-600">
                                Use Default
                            </div>
                        </button>
                    </div>
                </Input>
            </div>
        </Shell>
    );
}
