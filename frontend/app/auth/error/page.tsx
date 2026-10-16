import Shell from "@/components/layout/Shell";

export const dynamic = "force-dynamic";

type PageProps = {
    searchParams: Promise<{ reason?: string | string[] }>;
};

const messages: Record<string, string> = {
    access_denied: "サインインをキャンセルしました。アカウントは連携されていません。",
    invalid_state: "サインインの確認情報が一致しません。もう一度お試しください。",
    invalid_response: "認証サーバーからの応答を確認できませんでした。",
    token_exchange_failed: "認証を完了できませんでした。もう一度お試しください。",
};

export default async function AuthErrorPage({ searchParams }: PageProps) {
    const { reason } = await searchParams;
    const message =
        typeof reason === "string" && messages[reason]
            ? messages[reason]
            : "サインインを完了できませんでした。";

    return (
        <Shell title="サインイン" animateAppear>
            <p className="w-full text-center" role="alert">
                {message}
            </p>
            <a
                href="/auth/login"
                className="w-full rounded-2xl bg-(--color-foreground) px-4 py-3 text-center font-bold text-(--color-background) transition-transform active:scale-95"
            >
                もう一度試す
            </a>
            <a href="/" className="text-sm underline">
                ホームに戻る
            </a>
        </Shell>
    );
}
