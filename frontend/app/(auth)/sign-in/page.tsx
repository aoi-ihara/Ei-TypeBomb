import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import AuthForm from "@/components/account/AuthForm";

// The public form can be prerendered. Its return URL is read only on submit.
export default function Page() {
    return (
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
    );
}
