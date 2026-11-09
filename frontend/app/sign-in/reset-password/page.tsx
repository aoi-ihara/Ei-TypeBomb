import Header from "@/components/layout/Header";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import AuthForm from "@/components/account/AuthForm";
import { isOAuthEnabled } from "@/lib/auth/oauth-config";
import { getUser } from "@/lib/auth/session";
export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ update?: string; error?: string }>;
}) {
    const params = await searchParams;
    const update =
        params.update === "true" &&
        !isOAuthEnabled() &&
        Boolean(await getUser());
    return (
        <>
            <Header />
            <Shell title="パスワードをリセット">
                {params.error && (
                    <p role="alert">
                        リンクが無効か、有効期限が切れています。再設定メールを送り直してください。
                    </p>
                )}
                {isOAuthEnabled() ? (
                    <Button href="https://hub.vgnz93hs.com/sign-in/reset-password">
                        RC Hubで再設定
                    </Button>
                ) : (
                    <AuthForm mode={update ? "password" : "recovery"} />
                )}
                <Button href="/sign-in" variant="text">
                    ログインに戻る
                </Button>
            </Shell>
        </>
    );
}
