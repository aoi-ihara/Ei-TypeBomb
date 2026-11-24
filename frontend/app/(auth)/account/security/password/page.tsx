import AuthForm from "@/components/account/AuthForm";
import AccountPage from "../../AccountPage";

export default function Page() {
    return (
        <AccountPage title="パスワード" backLink="/account/security">
            <AuthForm mode="password-link" />
        </AccountPage>
    );
}
