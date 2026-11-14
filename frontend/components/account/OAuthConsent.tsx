"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";

type AuthorizationDetails = {
    client: { name: string; uri: string | null };
    redirect_uri: string;
    scope: string;
    csrf: string;
};

function Row({
    heading,
    body,
    font = "mono",
}: {
    heading?: string;
    body: string;
    font?: "mono" | "default" | "italic";
}) {
    return (
        <div className="flex">
            {heading && (
                <span
                    className="font-bold w-48 wrap-anywhere flex h-fit"
                    data-cursor="text"
                >
                    {heading}
                </span>
            )}
            <span
                className={`w-full ${font === "mono" ? "font-mono" : font === "italic" && "opacity-50 italic"} wrap-anywhere flex h-fit`}
                data-cursor="text"
            >
                {body}
            </span>
        </div>
    );
}

export default function OAuthConsent({ uid }: { uid: string }) {
    const [details, setDetails] = useState<AuthorizationDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        const load = async () => {
            try {
                const response = await fetch("/api/oauth/interaction/" + uid, {
                    headers: { Accept: "application/json" },
                    credentials: "same-origin",
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (
                    !response.ok ||
                    !response.headers
                        .get("content-type")
                        ?.includes("application/json")
                ) {
                    throw new Error("Invalid authorization request");
                }
                const data = (await response.json()) as AuthorizationDetails;
                if (!controller.signal.aborted) setDetails(data);
            } catch {
                if (!controller.signal.aborted) setError(true);
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        };
        void load();
        return () => controller.abort();
    }, [uid]);

    if (loading) {
        return <Shell title="アプリの接続リクエスト" size="large" loading />;
    }

    if (error || !details) {
        return (
            <Shell title="認証に失敗しました" size="small">
                <p data-cursor="text">リクエストを確認できませんでした。</p>
                <Button href="/" className="w-full" iconName="home">
                    ホームに戻る
                </Button>
            </Shell>
        );
    }

    const requestedScopes = (details.scope ?? "").split(/\s+/).filter(Boolean);
    const action = "/api/oauth/interaction/" + uid;

    return (
        <Shell title="アプリの接続リクエスト" size="large">
            <p className="w-full" data-cursor="text">
                次のアプリが、Ei-TypeBombアカウントへのアクセスを要求しています。許可する前にアプリ名,
                ウェブサイト, リダイレクト先を確認してください。
            </p>

            <h2 className="font-bold" data-cursor="text">
                情報
            </h2>
            <section className="rounded-2xl bg-(--color-background-secondary) p-4 flex flex-col gap-4">
                <Row heading="名称" body={details.client.name} />
                {details.client?.uri ? (
                    <Row heading="ウェブサイト" body={details.client.uri} />
                ) : (
                    <Row
                        heading="ウェブサイト"
                        body="ウェブサイトなし"
                        font="italic"
                    />
                )}
                <Row heading="リダイレクト先" body={details.redirect_uri} />
            </section>

            <h2 className="font-bold" data-cursor="text">
                要求されたデータ
            </h2>
            <p className="w-full" data-cursor="text">
                以下の情報が接続元のアプリに公開されます。
            </p>
            <section className="w-full rounded-2xl bg-(--color-background-secondary) p-4 flex flex-col gap-4">
                {requestedScopes.length > 0 ? (
                    requestedScopes.map((scope) => (
                        <Row key={scope} body={scope} />
                    ))
                ) : (
                    <p className="opacity-50 italic">要求されたデータなし</p>
                )}
            </section>
            <p className="w-full" data-cursor="text">
                心当たりのないアプリや、ウェブサイトとリダイレクト先が一致しない場合は許可しないでください。許可後もアカウント設定から取り消すことができます。
            </p>

            <div className="flex gap-4 w-full">
                <form action={action} method="post" className="w-full">
                    <input type="hidden" name="csrf" value={details.csrf} />
                    <input type="hidden" name="decision" value="deny" />
                    <Button type="submit" iconName="x" className="w-full">
                        拒否
                    </Button>
                </form>
                <form action={action} method="post" className="w-full">
                    <input type="hidden" name="csrf" value={details.csrf} />
                    <input type="hidden" name="decision" value="approve" />
                    <Button
                        type="submit"
                        iconName="check"
                        className="w-full"
                        variant="danger"
                    >
                        許可する
                    </Button>
                </form>
            </div>
        </Shell>
    );
}
