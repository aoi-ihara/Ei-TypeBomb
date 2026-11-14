import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import AuthForm from "@/components/account/AuthForm";
export default function Page() {
    return (
        <Shell title="アカウント作成">
            <AuthForm mode="sign-up" />
            <Button href="/sign-in" variant="text" iconName="logIn">
                サインイン
            </Button>
        </Shell>
    );
}
