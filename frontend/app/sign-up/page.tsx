import Header from "@/components/layout/Header";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import AuthForm from "@/components/account/AuthForm";
import { isOAuthEnabled } from "@/lib/auth/oauth-config";
export default function Page() {
    return (
        <>
            <Header />
            <Shell title="アカウント作成">
                {isOAuthEnabled() ? (
                    <Button href="https://hub.vgnz93hs.com/sign-up">
                        RC Hubでアカウントを作成
                    </Button>
                ) : (
                    <AuthForm mode="sign-up" />
                )}
                <Button href="/sign-in" variant="text">
                    ログインに戻る
                </Button>
            </Shell>
        </>
    );
}
