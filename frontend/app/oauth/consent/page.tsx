import { createClient } from "@/lib/db/server";
import { redirect } from "next/navigation";

type AuthorizationDetails = {
    client?: {
        name?: string | null;
        description?: string | null;
        uri?: string | null;
    };
    redirect_uri?: string;
    scope?: string;
};

function getAuthorizationId(value: FormDataEntryValue | null) {
    if (typeof value !== "string" || value.length < 1 || value.length > 512) {
        throw new Error("認証リクエストが正しくありません。");
    }
    return value;
}

async function decideAuthorization(formData: FormData, decision: "approve" | "deny") {
    const authorizationId = getAuthorizationId(formData.get("authorization_id"));
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
        redirect(
            "/auth/sign-in?next=" +
                encodeURIComponent(
                    "/oauth/consent?authorization_id=" +
                        encodeURIComponent(authorizationId),
                ),
        );
    }

    const result =
        decision === "approve"
            ? await supabase.auth.oauth.approveAuthorization(authorizationId)
            : await supabase.auth.oauth.denyAuthorization(authorizationId);

    if (result.error || !result.data?.redirect_url) {
        redirect("/auth/error?reason=authorization_failed");
    }

    redirect(result.data.redirect_url);
}

async function approveAuthorization(formData: FormData) {
    "use server";
    await decideAuthorization(formData, "approve");
}

async function denyAuthorization(formData: FormData) {
    "use server";
    await decideAuthorization(formData, "deny");
}

export const dynamic = "force-dynamic";

export default async function OAuthConsentPage({
    searchParams,
}: {
    searchParams: Promise<{ authorization_id?: string }>;
}) {
    const { authorization_id: authorizationId } = await searchParams;

    if (
        !authorizationId ||
        authorizationId.length > 512 ||
        /[\u0000-\u001f\u007f]/.test(authorizationId)
    ) {
        return (
            <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-16">
                <h1 className="text-2xl font-bold">認証リクエストを確認できません</h1>
                <p className="mt-3 text-sm text-neutral-500">
                    リクエストが無効か、有効期限が切れている可能性があります。
                </p>
            </main>
        );
    }

    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
        redirect(
            "/auth/sign-in?next=" +
                encodeURIComponent(
                    "/oauth/consent?authorization_id=" +
                        encodeURIComponent(authorizationId),
                ),
        );
    }

    const { data, error } =
        await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

    if (error || !data) {
        return (
            <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-16">
                <h1 className="text-2xl font-bold">認証リクエストを確認できません</h1>
                <p className="mt-3 text-sm text-neutral-500">
                    リクエストが無効か、有効期限が切れている可能性があります。
                </p>
            </main>
        );
    }

    const details = data as AuthorizationDetails;
    const clientName = details.client?.name?.trim() || "名称未設定のアプリ";
    const requestedScopes = (details.scope ?? "")
        .split(/\s+/)
        .filter(Boolean);

    return (
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-16">
            <div className="rounded-3xl border border-neutral-200 bg-white p-7 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 sm:p-9">
                <p className="text-xs font-semibold tracking-widest text-neutral-500">
                    EI-TYPEBOMB ACCOUNT
                </p>
                <h1 className="mt-5 text-2xl font-bold tracking-tight">
                    アクセスを許可しますか？
                </h1>
                <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                    次のアプリが、あなたのEi-TypeBombアカウントへのアクセスを要求しています。
                </p>

                <section className="mt-7 rounded-2xl bg-neutral-50 p-5 dark:bg-neutral-900">
                    <h2 className="text-lg font-semibold">{clientName}</h2>
                    {details.client?.description && (
                        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                            {details.client.description}
                        </p>
                    )}
                    {details.redirect_uri && (
                        <div className="mt-4">
                            <p className="text-xs text-neutral-500">リダイレクト先</p>
                            <p className="mt-1 break-all text-sm">{details.redirect_uri}</p>
                        </div>
                    )}
                </section>

                <section className="mt-6">
                    <h2 className="text-sm font-semibold">許可するアクセス</h2>
                    <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                        このアプリは、あなたが所有するルームの設定を読み取り、新しいルームの作成や既存ルームの編集を行えます。
                    </p>
                    {requestedScopes.length > 0 && (
                        <ul className="mt-3 list-inside list-disc text-sm text-neutral-500">
                            {requestedScopes.map((scope) => (
                                <li key={scope}>{scope}</li>
                            ))}
                        </ul>
                    )}
                </section>

                <div className="mt-8 grid grid-cols-2 gap-3">
                    <form action={denyAuthorization}>
                        <input
                            type="hidden"
                            name="authorization_id"
                            value={authorizationId}
                        />
                        <button
                            type="submit"
                            className="w-full rounded-full border border-neutral-300 px-4 py-3 text-sm font-semibold transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                        >
                            拒否
                        </button>
                    </form>
                    <form action={approveAuthorization}>
                        <input
                            type="hidden"
                            name="authorization_id"
                            value={authorizationId}
                        />
                        <button
                            type="submit"
                            className="w-full rounded-full bg-black px-4 py-3 text-sm font-semibold text-white transition hover:opacity-80 dark:bg-white dark:text-black"
                        >
                            許可する
                        </button>
                    </form>
                </div>
                <p className="mt-5 text-xs leading-5 text-neutral-500">
                    心当たりのないアプリからのリクエストは許可しないでください。許可後も、Supabaseアカウントの認可済みアプリからアクセスを取り消せます。
                </p>
            </div>
        </main>
    );
}
