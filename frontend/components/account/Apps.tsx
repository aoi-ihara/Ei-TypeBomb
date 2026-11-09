"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    listAuthorizedApps,
    revokeAuthorizedApp,
} from "@/lib/auth/oauth-grants";
import Button from "../ui/Button";
import { useRouter } from "next/navigation";

type AuthorizedApp = { clientId: string; name: string; url: string | null };

export default function Apps() {
    const [apps, setApps] = useState<AuthorizedApp[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const revokingRef = useRef(false);

    const router = useRouter();

    const loadApps = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await listAuthorizedApps();
            if (result.error) setError(result.error);
            else setApps(result.apps);
        } catch {
            setError("連携済みアプリを取得できませんでした。");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let active = true;
        const fetchApps = async () => {
            try {
                const result = await listAuthorizedApps();
                if (!active) return;
                if (result.error) setError(result.error);
                else setApps(result.apps);
            } catch {
                if (active) setError("連携済みアプリを取得できませんでした。");
            } finally {
                if (active) setLoading(false);
            }
        };

        void fetchApps();
        return () => {
            active = false;
        };
    }, []);

    const revoke = async (clientId: string) => {
        if (revokingRef.current) return;
        revokingRef.current = true;
        setRevokingId(clientId);
        setError(null);
        try {
            const result = await revokeAuthorizedApp(clientId);
            if (result.error) setError(result.error);
            else
                setApps((current) =>
                    current.filter((app) => app.clientId !== clientId),
                );
        } catch {
            setError("連携の解除に失敗しました。");
        } finally {
            revokingRef.current = false;
            setRevokingId(null);
        }
    };

    return (
        <section
            className="flex w-full flex-col gap-4"
            aria-label="連携済みアプリ"
        >
            {error && (
                <div
                    role="alert"
                    className="rounded-xl bg-red-500/10 p-3 text-sm text-red-500"
                >
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
                <div className="w-full flex justify-center">
                    <p
                        className="font-bold gradient-text"
                        data-cursor="text"
                        role="status"
                    >
                        読み込み中…
                    </p>
                </div>
            ) : apps.length === 0 && !error ? (
                <div className="w-full flex justify-center">
                    <p
                        className="opacity-50 italic"
                        data-cursor="text"
                        role="status"
                    >
                        連携済みアプリはありません。
                    </p>
                </div>
            ) : (
                <ul className="flex w-full flex-col gap-4">
                    {apps.map((app) => (
                        <li
                            key={app.clientId}
                            className="flex w-full min-w-0 items-center gap-3"
                        >
                            {app.url !== null ? (
                                <Button
                                    onClick={() => router.push(app.url ?? "")}
                                    padding="large"
                                    className="w-full"
                                    alignment="left"
                                >
                                    <span className="truncate font-extrabold">
                                        {app.name}
                                    </span>
                                </Button>
                            ) : (
                                <Button
                                    padding="large"
                                    className="w-full"
                                    alignment="left"
                                    disabled={true}
                                >
                                    <span className="truncate font-extrabold">
                                        {app.name}
                                    </span>
                                </Button>
                            )}
                            <Button
                                variant="danger"
                                iconName="trash"
                                padding="large"
                                loading={revokingId === app.clientId}
                                onClick={() => void revoke(app.clientId)}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
