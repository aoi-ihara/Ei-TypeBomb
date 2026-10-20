"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Shell from "@/components/layout/Shell";
import Input from "@/components/ui/Input";
import { parseETBClusterConfig } from "@/lib/room/clusterConfig";
import {
    getStoredServerConfig,
    SERVER_CONFIG_CHANGE_EVENT,
    SERVER_CONFIG_STORAGE_KEY,
} from "@/lib/room/serverUrl";

const subscribe = (onChange: () => void) => {
    window.addEventListener("storage", onChange);
    window.addEventListener(SERVER_CONFIG_CHANGE_EVENT, onChange);
    return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(SERVER_CONFIG_CHANGE_EVENT, onChange);
    };
};

const getServerSnapshot = () => "";

export default function ServerUrl() {
    const storedConfig = useSyncExternalStore(
        subscribe,
        getStoredServerConfig,
        getServerSnapshot,
    );
    const [draft, setDraft] = useState(storedConfig);
    const [storageError, setStorageError] = useState("");

    useEffect(() => setDraft(storedConfig), [storedConfig]);

    let error = "";
    let serverCount = 0;
    if (draft.trim()) {
        try {
            serverCount = parseETBClusterConfig(draft).length;
        } catch (cause) {
            error = cause instanceof Error
                ? cause.message.replaceAll("ETB_CLUSTER_CONFIG", "JSON")
                : "JSONの形式が正しくありません。";
        }
    }

    const setServerConfig = (value: string) => {
        setDraft(value);
        setStorageError("");
        // Keep the last valid config in use while the user is editing JSON.
        // Once the draft is valid, immediately apply it to subsequent connections.
        if (value.trim()) {
            try {
                parseETBClusterConfig(value);
            } catch {
                return;
            }
        }
        try {
            if (value.trim()) window.localStorage.setItem(SERVER_CONFIG_STORAGE_KEY, value);
            else window.localStorage.removeItem(SERVER_CONFIG_STORAGE_KEY);
            window.localStorage.removeItem("server-url");
            window.dispatchEvent(new Event(SERVER_CONFIG_CHANGE_EVENT));
        } catch {
            setStorageError("ブラウザに設定を保存できませんでした。");
        }
    };

    return (
        <Shell title="サーバー設定">
            <div className="w-full mb-4 space-y-3">
                <Input
                    variant="textarea"
                    value={draft}
                    onChange={(e) => setServerConfig(e.target.value)}
                    font="mono"
                    className="w-full"
                    inputClassName="min-h-56 resize-y text-sm leading-relaxed"
                    label="JSON"
                    alwaysFloatLabel
                />
                <div aria-live="polite" className="text-sm">
                    {storageError ? (
                        <p className="text-red-500">{storageError}</p>
                    ) : error ? (
                        <p className="text-red-500">{error} 前回の有効な設定が引き続き使用されます。</p>
                    ) : serverCount ? (
                        <p className="text-green-500">
                            {serverCount}台のサーバー設定を適用しました。次の接続から使用されます。
                        </p>
                    ) : (
                        <p className="opacity-60">
                            空欄の場合は環境変数の設定を使用します。
                        </p>
                    )}
                </div>
                <div className="flex justify-end">
                    <button
                        type="button"
                        className="active:scale-95 cursor-pointer px-2 py-1 transition-all duration-(--duration-etb) ease-etb font-bold text-cyan-600"
                        onClick={() => setServerConfig("")}
                    >
                        初期設定に戻す
                    </button>
                </div>
            </div>
        </Shell>
    );
}
