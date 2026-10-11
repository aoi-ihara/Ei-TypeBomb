"use client";

import { useSyncExternalStore } from "react";
import Shell from "@/components/layout/Shell";
import Input from "@/components/ui/Input";
import { getStoredServerUrl } from "@/lib/room/serverUrl";

const subscribe = (onChange: () => void) => {
    window.addEventListener("storage", onChange);
    window.addEventListener("server-url-change", onChange);
    return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener("server-url-change", onChange);
    };
};

const getServerSnapshot = () => "";

export default function ServerUrl() {
    const serverUrl = useSyncExternalStore(
        subscribe,
        getStoredServerUrl,
        getServerSnapshot,
    );

    const setServerUrl = (value: string) => {
        if (value) window.localStorage.setItem("server-url", value);
        else window.localStorage.removeItem("server-url");
        window.dispatchEvent(new Event("server-url-change"));
    };

    return (
        <Shell title="サーバーURL">
            <div className="inline w-full relative mb-4" data-cursor="text">
                <Input
                    value={serverUrl}
                    onChange={(e) => {
                        setServerUrl(e.target.value);
                    }}
                    type="url"
                    font="mono"
                    className="relative w-full"
                    inputClassName="pr-33"
                    label="サーバーURL"
                >
                    <div
                        className="bg-(--color-background) absolute top-3 rounded-md right-3"
                        data-cursor="button"
                        data-cursor-shape="1"
                    >
                        <button
                            className="active:scale-95 cursor-pointer px-2 py-1 transition-all duration-(--duration-etb) ease-etb"
                            onClick={() => {
                                setServerUrl("");
                            }}
                        >
                            <div className="transition-all duration-(--duration-etb) ease-etb font-bold text-cyan-600">
                                初期設定に戻す
                            </div>
                        </button>
                    </div>
                </Input>
            </div>
        </Shell>
    );
}
