"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Settings() {
    const router = useRouter();
    const [serverUrl, setServerUrl] = useState<string>(() => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("server-url") || "";
        }
        return "";
    });
    const [displayName, setDisplayName] = useState<string>(() => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("display-name") || "";
        }
        return "";
    });

    const handleSave = (serverUrlInput: string, displayNameInput: string) => {
        localStorage.setItem("server-url", serverUrlInput);
        localStorage.setItem("display-name", displayNameInput);
    };

    return (
        <div className="h-full flex flex-col gap-4 pt-16">
            <h1 data-cursor="text" className="font-bold">
                Settings
            </h1>
            <div data-cursor="text">Overwrite Connection</div>
            <div className="flex">
                <input
                    placeholder="Server URL"
                    type="url"
                    value={serverUrl}
                    data-cursor="text"
                    onChange={(e) => {
                        setServerUrl(e.target.value);
                        handleSave(e.target.value, displayName);
                    }}
                    className="outline-1"
                />
                <button
                    className="bg-cyan-600"
                    data-cursor="button"
                    data-cursor-shape="0"
                    onClick={() => {
                        setServerUrl("");
                        handleSave("", displayName);
                    }}
                >
                    Use Default
                </button>
            </div>

            <input
                placeholder="Display Name"
                type="text"
                value={displayName}
                data-cursor="text"
                onChange={(e) => {
                    setDisplayName(e.target.value);
                    handleSave(serverUrl, e.target.value);
                }}
                className="outline-1"
            />

            <button
                className="bg-cyan-600"
                data-cursor="button"
                data-cursor-shape="0"
                onClick={() => router.push("/")}
            >
                Home
            </button>
        </div>
    );
}
