import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import AuthForm from "@/components/account/AuthForm";
import { hasPasswordRecovery } from "@/lib/auth/password-recovery";
import { createClient } from "@/lib/db/server";
export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ update?: string; error?: string }>;
}) {
    const params = await searchParams;
    const updateRequested = params.update === "true";
    const update = updateRequested && await hasPasswordRecovery((await createClient()).auth);
    return (
        <Shell title="パスワードをリセット">
            {(params.error || (updateRequested && !update)) && (
                <p role="alert">
                    リンクが無効か、有効期限が切れています。再設定メールを送り直してください。
                </p>
            )}
            <AuthForm mode={update ? "password" : "recovery"} />
            <Button href="/sign-in" variant="text" iconName="logIn">
                サインイン
            </Button>
        </Shell>
    );
}
