import Header from "@/components/layout/Header";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import AuthForm from "@/components/account/AuthForm";
import { safeReturnPath } from "@/lib/auth/oauth-config";

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ next?: string }>;
}) {
    const { next } = await searchParams;
    const returnTo = next ? safeReturnPath(next) : undefined;
    return (
        <>
            <Header />
            <Shell title="サインイン">
                <AuthForm mode="sign-in" next={returnTo} />
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
