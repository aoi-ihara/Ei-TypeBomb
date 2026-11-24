import AuthForm from "@/components/account/AuthForm";
import AccountPage from "../../AccountPage";

export default function Page() {
    return (
        <AccountPage title="メールアドレス" backLink="/account/security">
            <AuthForm mode="email" />
        </AccountPage>
    );
}
