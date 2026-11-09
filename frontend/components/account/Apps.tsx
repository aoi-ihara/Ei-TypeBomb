"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";

type AuthorizedApp = {
    clientId: string;
    grantId: string;
    name: string;
    url: string | null;
};
type ConnectionsResponse = {
    csrf: string;
    apps: AuthorizedApp[];
};

export default function Apps() {
    const [apps, setApps] = useState<AuthorizedApp[]>([]);
    const [csrf, setCsrf] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const revokingRef = useRef(false);

    const loadApps = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/oauth/connections", {
                headers: { Accept: "application/json" },
                cache: "no-store",
                credentials: "same-origin",
                signal,
            });
            if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
                throw new Error("Could not load connections");
            }
            const data = (await response.json()) as ConnectionsResponse;
            if (signal?.aborted) return;
            setApps(data.apps);
            setCsrf(data.csrf);
        } catch {
            if (!signal?.aborted) setError("連携済みアプリを取得できませんでした。");
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void loadApps(controller.signal);
        return () => controller.abort();
    }, [loadApps]);

    const revoke = async (app: AuthorizedApp) => {
        if (revokingRef.current || !csrf) return;
        if (!window.confirm("「" + app.name + "」の接続を解除しますか？")) return;
        revokingRef.current = true;
        setRevokingId(app.clientId);
        setError(null);
        try {
            const response = await fetch("/api/oauth/connections", {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                credentials: "same-origin",
                body: new URLSearchParams({ csrf, grant_id: app.grantId }),
            });
            if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
                throw new Error("Could not revoke connection");
            }
            setApps((current) => current.filter((item) => item.clientId !== app.clientId));
        } catch {
            setError("連携の解除に失敗しました。");
        } finally {
            revokingRef.current = false;
            setRevokingId(null);
        }
    };

    return (
        <section className="flex w-full flex-col gap-4" aria-label="連携済みアプリ">
            <p className="w-full text-sm opacity-70" data-cursor="text">
                接続を許可したアプリを管理できます。解除すると、そのアプリのアクセストークンと更新トークンが失効します。
            </p>
            {error && (
                <div role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-500">
                    {error}
                    <button
                        type="button"
                        className="ml-3 underline"
                        onClick={() => void loadApps()}
                    >
                        再試行
                    </button>
                </div>
            )}
            {loading ? (
                <div className="flex w-full justify-center">
                    <p className="font-bold gradient-text" role="status" data-cursor="text">
                        読み込み中…
                    </p>
                </div>
            ) : apps.length === 0 && !error ? (
                <div className="flex w-full justify-center">
                    <p className="italic opacity-50" role="status" data-cursor="text">
                        連携済みアプリはありません。
                    </p>
                </div>
            ) : (
                <ul className="flex w-full flex-col gap-4">
                    {apps.map((app) => (
                        <li key={app.clientId} className="flex w-full min-w-0 items-center gap-3">
                            <Button
                                className="min-w-0 flex-1"
                                padding="large"
                                alignment="left"
                                disabled={!app.url}
                                onClick={() => {
                                    if (app.url) window.open(app.url, "_blank", "noopener,noreferrer");
                                }}
                            >
                                <span className="block truncate font-extrabold">{app.name}</span>
                            </Button>
                            <Button
                                variant="danger"
                                iconName="trash"
                                padding="large"
                                className="shrink-0"
                                loading={revokingId === app.clientId}
                                disabled={revokingId !== null}
                                onClick={() => void revoke(app)}
                            >
                                <span className="sr-only">{app.name} の接続を解除</span>
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
