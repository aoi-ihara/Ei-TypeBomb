import Header from "@/components/layout/Header";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import AuthForm from "@/components/account/AuthForm";
import { isOAuthEnabled } from "@/lib/auth/oauth-config";
import { redirect } from "next/navigation";
export default function Page() {
    if (isOAuthEnabled()) redirect("/auth/sign-in");
    return (
        <>
            <Header />
            <Shell title="サインイン">
                <AuthForm mode="sign-in" />
                <Button href="/sign-up" variant="text" iconName="userRoundPlus">
                    サインアップ
                </Button>
                <Button
                    href="/sign-in/reset-password"
                    variant="text"
                    iconName="keyRound"
                >
                    パスワードをリセット
                </Button>
            </Shell>
        </>
    );
}
