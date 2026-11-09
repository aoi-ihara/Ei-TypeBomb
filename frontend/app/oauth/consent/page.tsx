import { createClient } from "@/lib/db/server";
import { redirect } from "next/navigation";
import Shell from "@/components/layout/Shell";
import Header from "@/components/layout/Header";
import Button from "@/components/ui/Button";

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

function getAuthorizationId(value: FormDataEntryValue | null) {
    if (typeof value !== "string" || value.length < 1 || value.length > 512) {
        throw new Error("認証リクエストが正しくありません。");
    }
    return value;
}

async function decideAuthorization(
    formData: FormData,
    decision: "approve" | "deny",
) {
    const authorizationId = getAuthorizationId(
        formData.get("authorization_id"),
    );
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
                <h1 className="text-2xl font-bold">
                    認証リクエストを確認できません
                </h1>
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
            <>
                <Header />
                <Shell title="認証に失敗しました" size="small">
                    <p data-cursor="text">リクエストを確認できませんでした。</p>
                    <Button href="/" className="w-full" iconName="home">
                        ホームに戻る
                    </Button>
                </Shell>
            </>
        );
    }

    if (!("authorization_id" in data)) {
        redirect(data.redirect_url);
    }

    const details = data;
    const requestedScopes = (details.scope ?? "").split(/\s+/).filter(Boolean);

    return (
        <>
            <Header />
            <Shell title="アプリの接続リクエスト" size="large">
                <p className="w-full" data-cursor="text">
                    次のアプリが、Supabaseアカウント認証を要求しています。許可する前にアプリ名,
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
                        <p className="opacity-50 italic">
                            要求されたデータなし
                        </p>
                    )}
                </section>
                <p className="w-full" data-cursor="text">
                    心当たりのないアプリや、ウェブサイトとリダイレクト先が一致しない場合は許可しないでください。許可後もアカウント設定から取り消すことができます。
                </p>

                <div className="flex gap-4 w-full">
                    <form action={denyAuthorization} className="w-full">
                        <input
                            type="hidden"
                            name="authorization_id"
                            value={authorizationId}
                        />
                        <Button type="submit" iconName="x" className="w-full">
                            拒否
                        </Button>
                    </form>
                    <form action={approveAuthorization} className="w-full">
                        <input
                            type="hidden"
                            name="authorization_id"
                            value={authorizationId}
                        />
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
        </>
    );
}
