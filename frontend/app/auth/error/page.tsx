import Client from "./Client";

export const dynamic = "force-dynamic";

type PageProps = {
    searchParams: Promise<{ reason?: string | string[] }>;
};

const messages: Record<string, string> = {
    access_denied:
        "サインインをキャンセルしました。アカウントは連携されていません。",
    invalid_state:
        "サインインの確認情報が一致しません。もう一度お試しください。",
    invalid_response: "認証サーバーからの応答を確認できませんでした。",
    token_exchange_failed:
        "認証を完了できませんでした。もう一度お試しください。",
};

export default async function AuthErrorPage({ searchParams }: PageProps) {
    const { reason } = await searchParams;

    const message =
        typeof reason === "string" && messages[reason]
            ? messages[reason]
            : "サインインを完了できませんでした。";

    return <Client message={message} />;
}
